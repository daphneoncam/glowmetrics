// app/api/stripe/checkout/route.js
import { NextResponse } from 'next/server'
import { stripe } from '../../../../lib/stripe'
import { createSupabaseRouteClient } from '../../../../lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    let supabase = createSupabaseRouteClient()
    let { data: { user } } = await supabase.auth.getUser()

    // Browser sessions normally arrive through Supabase SSR cookies. The bearer
    // fallback keeps checkout authenticated if the page was reached through a
    // host transition or the cookie was not refreshed before this request.
    if (!user) {
      const authorization = request.headers.get('authorization') || ''
      const accessToken = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : null

      if (accessToken) {
        const tokenClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          }
        )
        const tokenResult = await tokenClient.auth.getUser(accessToken)
        user = tokenResult.data.user
        if (user) supabase = tokenClient
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Your login session expired. Please sign in again.' },
        { status: 401 }
      )
    }

    // Billing writes and billing analytics are server-owned. Bind every write
    // to the authenticated user above; never accept a user id from the client.
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Get or create customer — profiles is the single source of truth
    let customerId
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, trial_ends_at')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Checkout: failed to read profile', profileError.message)
    }

    // A stored customer can be stale: deleted in the Stripe dashboard, or
    // created under a different Stripe key/mode. Stripe then rejects checkout
    // with "No such customer", blocking the upgrade. Verify it first; only a
    // confirmed deleted/missing customer is replaced. Any other error (network,
    // rate limit) keeps the stored id so behaviour is unchanged.
    if (profile?.stripe_customer_id) {
      try {
        const existing = await stripe.customers.retrieve(profile.stripe_customer_id)
        if (existing && !existing.deleted) customerId = profile.stripe_customer_id
        else console.warn('Checkout: stored Stripe customer is deleted; creating a new one', profile.stripe_customer_id)
      } catch (err) {
        if (err?.code === 'resource_missing' || err?.statusCode === 404) {
          console.warn('Checkout: stored Stripe customer not found; creating a new one', profile.stripe_customer_id)
        } else {
          customerId = profile.stripe_customer_id
        }
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id }
      })
      customerId = customer.id

      // stripe_customer_id is a server-only billing column (browser roles have
      // no UPDATE on it — migration 20261010), so it is written with the
      // service role, scoped to the authenticated caller's own id.
      const { error: updateError } = await admin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)

      if (updateError) {
        console.error('Checkout: failed to save stripe_customer_id', updateError.message)
        // Don't fail checkout — customer was created in Stripe, that's what matters
        // The webhook will save the customer ID when subscription completes
      }
    }

    // Resolve the correct Stripe price ID based on plan_type
    const planType = body.plan_type || 'standard_monthly'

    const PRICE_MAP = {
      standard_monthly:      process.env.STRIPE_MONTHLY_PRICE_ID || process.env.STRIPE_PRICE_STANDARD_MONTHLY || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID,
      standard_annual:       process.env.STRIPE_YEARLY_PRICE_ID || process.env.STRIPE_ANNUAL_PRICE_ID || process.env.STRIPE_PRICE_STANDARD_ANNUAL || process.env.NEXT_PUBLIC_STRIPE_PRICE_ANNUAL,
    }

    if (!Object.prototype.hasOwnProperty.call(PRICE_MAP, planType)) {
      return NextResponse.json({ error: 'Invalid subscription plan selected.' }, { status: 400 })
    }

    let priceId = PRICE_MAP[planType]

    // The advertised price is the contract: $9.99/month, $99/year. The
    // monthly env var pointed at a $19.99 price, so every price is checked
    // against Stripe before checkout. Monthly falls back to the $9.99 price's
    // lookup key; anything still not matching is refused (never overcharge).
    const ADVERTISED = {
      standard_monthly: { amount: 999,  interval: 'month', lookupKey: 'Monthly_Premuim' },
      standard_annual:  { amount: 9900, interval: 'year',  lookupKey: null },
    }
    const expected = ADVERTISED[planType]
    const matches = (p) => p && p.active && p.currency === 'usd'
      && p.unit_amount === expected.amount && p.recurring?.interval === expected.interval
    let price = null
    if (priceId && priceId.startsWith('price_')) {
      price = await stripe.prices.retrieve(priceId).catch(() => null)
    }
    if (!matches(price) && expected.lookupKey) {
      const found = await stripe.prices.list({ lookup_keys: [expected.lookupKey], active: true, limit: 1 })
      price = found.data[0] || null
    }
    if (!matches(price)) {
      console.error(`Checkout: no active Stripe price matches the advertised ${planType} amount (${expected.amount})`)
      return NextResponse.json(
        { error: `The ${planType.includes('annual') ? 'annual' : 'monthly'} Stripe price is not configured correctly.` },
        { status: 500 }
      )
    }
    priceId = price.id

    // Create checkout session with 7-day trial
    // Card is collected immediately but not charged until after 7 days
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,  // Card on file, charge after 7 days
        metadata: {
          userId: user.id,
          plan_type: planType,
        }
      },
      success_url: `${request.headers.get('origin')}/dashboard?success=true&trial=7days&plan=${planType}`,
      cancel_url: `${request.headers.get('origin')}/dashboard?canceled=true`,
      metadata: {
        userId: user.id,
        plan_type: planType,
      }
    })

    if (!session.url) {
      return NextResponse.json({ error: 'Stripe Checkout did not return a payment URL.' }, { status: 500 })
    }

    // Server-authoritative funnel tracking. Previously these tables depended on
    // optional client tracking, so pricing/landing checkout attempts could be
    // invisible even though Stripe customers or sessions were created.
    const billingCycle = planType === 'standard_annual' ? 'annual' : 'monthly'
    const planPrice = expected.amount / 100
    const trackedAt = new Date().toISOString()

    const { error: checkoutTrackError } = await admin.from('checkout_events').insert({
      user_id: user.id,
      session_id: session.id,
      status: 'checkout_created',
      plan_type: planType,
      plan_price: planPrice,
      billing_cycle: billingCycle,
      stripe_session_id: session.id,
      properties: {
        source: 'server_checkout_route',
        customer_id: customerId,
        price_id: priceId,
        trial_days: 7,
        created_at: trackedAt,
      },
    })
    if (checkoutTrackError) {
      console.error('Checkout: failed to record checkout event', checkoutTrackError.message)
    }

    const { error: trialTrackError } = await admin.from('free_trial_events').insert({
      user_id: user.id,
      event_type: 'trial_checkout_created',
      trial_days_offered: 7,
      properties: {
        source: 'server_checkout_route',
        stripe_session_id: session.id,
        customer_id: customerId,
        plan_type: planType,
        billing_cycle: billingCycle,
        created_at: trackedAt,
      },
    })
    if (trialTrackError) {
      console.error('Checkout: failed to record trial attempt', trialTrackError.message)
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
