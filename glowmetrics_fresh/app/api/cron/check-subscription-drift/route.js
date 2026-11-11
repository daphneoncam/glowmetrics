import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Only a paid active subscription earns full Pro. A Stripe trial stays on the
// capped trial entitlement path even though it has a subscription record.
function expectedPlanFor(stripeStatus) {
  return stripeStatus === 'active' ? 'pro' : 'free'
}

async function sendDriftAlert(mismatches) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Was the old GlowMetrics domain (unverified): see the note on owner
        // alerts in app/api/stripe/webhook/route.js.
        from: 'CamCash <noreply@camcashgrl.com>',
        to: process.env.OWNER_EMAIL || 'daphneoncam@gmail.com',
        subject: `⚠️ Subscription drift: ${mismatches.length} profile(s) out of sync with Stripe`,
        text: mismatches.map(m =>
          `user ${m.userId} (sub ${m.stripeSubscriptionId}): ` +
          `Stripe says status=${m.stripeStatus}, Supabase has subscription_status=${m.dbStatus}, plan=${m.dbPlan} ` +
          `(expected plan=${m.expectedPlan})`
        ).join('\n'),
      }),
    })
    if (!res.ok) console.error('[cron/check-subscription-drift] alert email rejected:', res.status)
  } catch (e) {
    console.error('[cron/check-subscription-drift] Failed to send alert email:', e.message)
  }
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: profiles, error: selectError } = await supabase
    .from('profiles')
    .select('id, plan, subscription_status, stripe_subscription_id')
    .not('stripe_subscription_id', 'is', null)
    .limit(500)

  if (selectError) {
    console.error('[cron/check-subscription-drift] select failed:', selectError.message)
    return NextResponse.json({ success: false, error: selectError.message }, { status: 500 })
  }

  if (!profiles?.length) {
    return NextResponse.json({ success: true, checked: 0, mismatches: [] })
  }

  const mismatches = []
  let checked = 0

  for (const profile of profiles) {
    let sub
    try {
      sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id)
    } catch (e) {
      console.error(`[cron/check-subscription-drift] could not retrieve ${profile.stripe_subscription_id}:`, e.message)
      continue
    }
    checked++

    const expectedPlan = expectedPlanFor(sub.status)
    const statusMismatch = profile.subscription_status !== sub.status
    const planMismatch = profile.plan !== expectedPlan

    if (statusMismatch || planMismatch) {
      mismatches.push({
        userId: profile.id,
        stripeSubscriptionId: profile.stripe_subscription_id,
        stripeStatus: sub.status,
        dbStatus: profile.subscription_status,
        dbPlan: profile.plan,
        expectedPlan,
      })
    }
  }

  if (mismatches.length > 0) {
    console.warn(`[cron/check-subscription-drift] found ${mismatches.length} mismatch(es):`, mismatches)
    await sendDriftAlert(mismatches)
  }

  return NextResponse.json({ success: true, checked, mismatches })
}
