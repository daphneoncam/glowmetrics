import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function getUserByEmail(supabase, email) {
  if (!email) return null
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) return null
    const match = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < perPage) return null
    page++
  }
}

export async function getUserById(supabase, userId) {
  if (!userId) return null
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) return null
  return data.user
}

export async function getUserByCustomerId(supabase, customerId) {
  if (!customerId) return null
  const { data, error } = await supabase
    .from('profiles').select('id').eq('stripe_customer_id', customerId).limit(2)
  if (error || !data || data.length !== 1) return null
  return getUserById(supabase, data[0].id)
}

export async function resolveUser(supabase, { userId, email, customerId }) {
  return (await getUserById(supabase, userId))
    || (await getUserByCustomerId(supabase, customerId))
    || getUserByEmail(supabase, email)
}

async function getEmailFromCustomer(customerId) {
  const customer = await stripe.customers.retrieve(customerId)
  return customer?.email || null
}

// Owner alerts. Previously sent from a notifications address on the old
// GlowMetrics domain (not the verified sending domain), with a fallback inbox
// on that domain too, so they were most likely never delivered. Now sent from
// the address the daily admin summary already delivers from, to OWNER_EMAIL
// or the same admin inbox.
const OWNER_ALERT_FROM = 'CamCash <noreply@camcashgrl.com>'
const OWNER_ALERT_TO = process.env.OWNER_EMAIL || 'daphneoncam@gmail.com'

async function sendResendNotification(subject, text, to = OWNER_ALERT_TO) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: OWNER_ALERT_FROM,
        to,
        subject,
        text,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      console.error('Resend notification rejected:', res.status, body?.message || '')
    }
  } catch (e) {
    console.error('Resend notification failed:', e.message)
  }
}

const SYNC_ALERT_EMAIL = 'daphneoncam@gmail.com'
export const RETRY_STATUS = 500

async function alertUnresolvedUser(eventType, event, { userId, email, customerId, subscriptionId }) {
  console.error(`Webhook ${eventType}: could not resolve a user (userId=${userId}, email=${email})`)
  await sendResendNotification(
    `🚨 Subscription sync FAILED — unresolved user (${eventType})`,
    `Stripe event ${event.id} (${eventType}) could not be matched to any Supabase user.\n\n` +
      `userId from metadata: ${userId || '(none)'}\nemail: ${email || '(none)'}\ncustomer: ${customerId || '(none)'}\nsubscription: ${subscriptionId || '(none)'}\n\n` +
      `This event was dropped — no profile or subscription row was written. The webhook returned 500, so Stripe will retry; if this keeps failing, check manually.`,
    SYNC_ALERT_EMAIL
  )
}

async function updateProfile(supabase, userId, update) {
  const { error } = await supabase.from('profiles').update(update).eq('id', userId)
  if (error) {
    console.error(`Webhook: failed to update profile ${userId} with`, update, error.message)
    await sendResendNotification(
      `🚨 Subscription sync FAILED — profiles (user ${userId})`,
      `Failed to write to profiles for user ${userId}.\n\nAttempted update: ${JSON.stringify(update)}\n\nError: ${error.message}\n\nThis user's plan/subscription_status may now be stale — check manually.`,
      SYNC_ALERT_EMAIL
    )
    return false
  }
  return true
}

function planTypeFor(sub) {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval
  return interval === 'year' ? 'standard_annual' : 'standard_monthly'
}

function billingCycleFor(sub) {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval
  return interval === 'year' ? 'annual' : 'monthly'
}

async function upsertSubscriptionRecord(supabase, userId, fields) {
  const { error } = await supabase
    .from('subscriptions')
    .upsert({ user_id: userId, updated_at: new Date().toISOString(), ...fields }, { onConflict: 'user_id' })
  if (error) {
    console.error(`Webhook: failed to upsert subscriptions row for ${userId}:`, error.message)
    await sendResendNotification(
      `🚨 Subscription sync FAILED — subscriptions (user ${userId})`,
      `Failed to write to subscriptions for user ${userId}.\n\nAttempted fields: ${JSON.stringify(fields)}\n\nError: ${error.message}\n\nAdmin/dashboard subscriber and revenue stats read from this table — this user may now be undercounted or shown with the wrong status until manually corrected.`,
      SYNC_ALERT_EMAIL
    )
    return false
  }
  return true
}

async function logSubscriptionEvent(supabase, userId, eventType, details) {
  try {
    if (details.stripeEventId) {
      const { data: existing } = await supabase.from('subscription_events')
        .select('id').eq('stripe_event_id', details.stripeEventId).eq('event_type', eventType).limit(1)
      if (existing?.length) return
    }
    await supabase.rpc('log_subscription_event', {
      p_user_id: userId,
      p_event_type: eventType,
      p_stripe_event_id: details.stripeEventId || null,
      p_customer_id: details.customerId || null,
      p_subscription_id: details.subscriptionId || null,
      p_prev_plan: details.previousPlan || null,
      p_new_plan: details.newPlan || null,
      p_details: details,
    })
  } catch (e) {
    console.error(`Failed to log subscription event: ${e.message}`)
  }
}

async function logWebhookEvent(supabase, event, status, errorMessage = null) {
  try {
    if (!supabase) return
    await supabase.from('webhook_events').upsert({
      stripe_event_id: event.id,
      event_type: event.type,
      status,
      error_message: errorMessage,
      event_data: event.data,
      created_at: new Date().toISOString(),
    }, { onConflict: 'stripe_event_id' })
  } catch (e) {
    console.error('Failed to log webhook event:', e.message)
  }
}

export async function alreadyProcessed(supabase, eventId) {
  if (!eventId) return false
  const { data } = await supabase.from('webhook_events')
    .select('status').eq('stripe_event_id', eventId).limit(1)
  return data?.[0]?.status === 'success'
}

export async function isStaleSubscription(supabase, userId, sub) {
  const { data } = await supabase.from('profiles')
    .select('stripe_subscription_id').eq('id', userId).maybeSingle()
  const currentId = data?.stripe_subscription_id
  if (!currentId || !sub?.id || currentId === sub.id) return false
  const current = await stripe.subscriptions.retrieve(currentId).catch(() => null)
  if (!current) return false
  return (current.created || 0) > (sub.created || 0)
}

export async function POST(request) {
  const supabase = getSupabaseAdmin()
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json({ error: err.message }, { status: 400 })
  }

  if (await alreadyProcessed(supabase, event.id)) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const email = session.customer_details?.email || session.customer_email
        const user = await resolveUser(supabase, { userId: session.metadata?.userId, email, customerId: session.customer })
        if (!user) {
          await alertUnresolvedUser('checkout.session.completed', event, {
            userId: session.metadata?.userId, email, customerId: session.customer,
          })
          await logWebhookEvent(supabase, event, 'user_resolution_failed', `Could not resolve user: ${email}`)
          return NextResponse.json({ error: 'Could not resolve user' }, { status: RETRY_STATUS })
        }

        // Checkout completion only stores the Stripe customer link. The
        // subscription event is the source of truth for trial vs paid access.
        const ok = await updateProfile(supabase, user.id, {
          stripe_customer_id: session.customer,
        })
        if (!ok) {
          await logWebhookEvent(supabase, event, 'profile_update_failed', `Failed to update profile for ${email}`)
          return NextResponse.json({ error: 'Failed to update profile' }, { status: RETRY_STATUS })
        }

        await sendResendNotification(
          `💳 CamCash checkout completed — ${email}`,
          `${email} completed checkout. Subscription status will determine trial or paid Pro access.`
        )
        break
      }

      case 'customer.subscription.created': {
        const sub = event.data.object
        const email = await getEmailFromCustomer(sub.customer)
        const user = await resolveUser(supabase, { userId: sub.metadata?.userId, email, customerId: sub.customer })
        if (!user) {
          await alertUnresolvedUser('customer.subscription.created', event, {
            userId: sub.metadata?.userId, email, customerId: sub.customer, subscriptionId: sub.id,
          })
          await logWebhookEvent(supabase, event, 'user_resolution_failed', `Could not resolve user: ${email}`)
          return NextResponse.json({ error: 'Could not resolve user' }, { status: RETRY_STATUS })
        }

        const subscriptionStatus = sub.status
        const plan = subscriptionStatus === 'active' ? 'pro' : 'free'
        const update = {
          plan,
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          subscription_status: subscriptionStatus,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        }

        const profileOk = await updateProfile(supabase, user.id, update)
        if (!profileOk) {
          await logWebhookEvent(supabase, event, 'profile_update_failed', `Failed to update profile for ${email}`)
          return NextResponse.json({ error: 'Failed to update profile' }, { status: RETRY_STATUS })
        }

        const subsOk = await upsertSubscriptionRecord(supabase, user.id, {
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items?.data?.[0]?.price?.id || null,
          plan_type: planTypeFor(sub),
          billing_cycle: billingCycleFor(sub),
          status: sub.status,
          current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        })
        if (!subsOk) {
          await logWebhookEvent(supabase, event, 'subscriptions_upsert_failed', `Failed to upsert subscriptions for ${email}`)
          return NextResponse.json({ error: 'Failed to upsert subscriptions' }, { status: RETRY_STATUS })
        }

        await logSubscriptionEvent(supabase, user.id, 'subscription_started', {
          stripeEventId: event.id,
          customerId: sub.customer,
          subscriptionId: sub.id,
          newPlan: plan,
          details: { status: sub.status, trialEnd: sub.trial_end },
        })

        await sendResendNotification(
          subscriptionStatus === 'active' ? `💰 New Paid Subscription — ${email}` : `🎁 Trial Started — ${email}`,
          `${email} started a ${subscriptionStatus} subscription (ID: ${sub.id}).`
        )
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const email = await getEmailFromCustomer(sub.customer)
        const user = await resolveUser(supabase, { userId: sub.metadata?.userId, email, customerId: sub.customer })
        if (!user) {
          await alertUnresolvedUser('customer.subscription.deleted', event, {
            userId: sub.metadata?.userId, email, customerId: sub.customer, subscriptionId: sub.id,
          })
          await logWebhookEvent(supabase, event, 'user_resolution_failed', `Could not resolve user: ${email}`)
          return NextResponse.json({ error: 'Could not resolve user' }, { status: RETRY_STATUS })
        }

        if (await isStaleSubscription(supabase, user.id, sub)) {
          await logWebhookEvent(supabase, event, 'success', `Skipped: ${sub.id} is not the profile's current subscription`)
          return NextResponse.json({ received: true, status: 'stale_subscription_ignored' })
        }

        const update = {
          plan: 'free',
          subscription_status: 'canceled',
          trial_ends_at: null,
        }

        const profileOk = await updateProfile(supabase, user.id, update)
        if (!profileOk) {
          await logWebhookEvent(supabase, event, 'profile_update_failed', `Failed to downgrade profile for ${email}`)
          return NextResponse.json({ error: 'Failed to update profile' }, { status: RETRY_STATUS })
        }

        const subsOk = await upsertSubscriptionRecord(supabase, user.id, {
          plan_type: 'free',
          billing_cycle: null,
          status: 'canceled',
        })
        if (!subsOk) {
          await logWebhookEvent(supabase, event, 'subscriptions_upsert_failed', `Failed to upsert subscriptions for ${email}`)
          return NextResponse.json({ error: 'Failed to upsert subscriptions' }, { status: RETRY_STATUS })
        }

        await logSubscriptionEvent(supabase, user.id, 'subscription_canceled', {
          stripeEventId: event.id,
          customerId: sub.customer,
          subscriptionId: sub.id,
          previousPlan: 'pro',
          newPlan: 'free',
        })

        await sendResendNotification(
          `❌ Subscription Canceled — ${email}`,
          `${email} cancelled their subscription.`
        )
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const email = await getEmailFromCustomer(sub.customer)
        const user = await resolveUser(supabase, { userId: sub.metadata?.userId, email, customerId: sub.customer })
        if (!user) {
          await alertUnresolvedUser('customer.subscription.updated', event, {
            userId: sub.metadata?.userId, email, customerId: sub.customer, subscriptionId: sub.id,
          })
          await logWebhookEvent(supabase, event, 'user_resolution_failed', `Could not resolve user: ${email}`)
          return NextResponse.json({ error: 'Could not resolve user' }, { status: RETRY_STATUS })
        }

        if (await isStaleSubscription(supabase, user.id, sub)) {
          await logWebhookEvent(supabase, event, 'success', `Skipped: ${sub.id} is not the profile's current subscription`)
          return NextResponse.json({ received: true, status: 'stale_subscription_ignored' })
        }

        const subscriptionStatus = sub.status
        const plan = subscriptionStatus === 'active' ? 'pro' : 'free'

        const update = {
          plan,
          stripe_subscription_id: sub.id,
          subscription_status: subscriptionStatus,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        }

        const profileOk = await updateProfile(supabase, user.id, update)
        if (!profileOk) {
          await logWebhookEvent(supabase, event, 'profile_update_failed', `Failed to update profile for ${email}`)
          return NextResponse.json({ error: 'Failed to update profile' }, { status: RETRY_STATUS })
        }

        const subsOk = await upsertSubscriptionRecord(supabase, user.id, {
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items?.data?.[0]?.price?.id || null,
          plan_type: plan === 'pro' ? planTypeFor(sub) : 'free',
          billing_cycle: plan === 'pro' ? billingCycleFor(sub) : null,
          status: sub.status,
          current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        })
        if (!subsOk) {
          await logWebhookEvent(supabase, event, 'subscriptions_upsert_failed', `Failed to upsert subscriptions for ${email}`)
          return NextResponse.json({ error: 'Failed to upsert subscriptions' }, { status: RETRY_STATUS })
        }

        await logSubscriptionEvent(supabase, user.id, 'subscription_updated', {
          stripeEventId: event.id,
          customerId: sub.customer,
          subscriptionId: sub.id,
          newPlan: plan,
          details: { status: sub.status, reason: event.data.previous_attributes },
        })

        if (subscriptionStatus === 'active') {
          await sendResendNotification(
            `💰 Subscription Active — ${email}`,
            `${email}'s subscription is now active.`
          )
        } else if (subscriptionStatus === 'trialing') {
          await sendResendNotification(
            `🎁 Trial Updated — ${email}`,
            `${email}'s subscription remains trialing and capped.`
          )
        } else {
          await sendResendNotification(
            `❌ Subscription Issue — ${email}`,
            `${email}'s subscription status changed to ${sub.status}.`
          )
        }
        break
      }

      default:
        console.warn(`Unhandled Stripe event type: ${event.type}`)
        await logWebhookEvent(supabase, event, 'unhandled_event_type', `Unhandled event type: ${event.type}`)
        break
    }

    await logWebhookEvent(supabase, event, 'success', null)
    return NextResponse.json({ received: true, status: 'success' })
  } catch (err) {
    console.error('Webhook handler error:', err)
    await logWebhookEvent(supabase, event, 'handler_error', err.message)
    return NextResponse.json({ error: err.message }, { status: RETRY_STATUS })
  }
}
