// app/api/stripe/portal/route.js
import { NextResponse } from 'next/server'
import { stripe } from '../../../../lib/stripe'
import { createSupabaseRouteClient } from '../../../../lib/supabase-server'

export async function POST(request) {
  try {
    const supabase = createSupabaseRouteClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Portal: failed to read profile', profileError.message)
    }

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    // A stored customer can be stale (deleted in Stripe, or from another
    // Stripe key/mode). Stripe would reject the portal with a raw
    // "No such customer" error. Treat a confirmed deleted/missing customer as
    // "no subscription"; checkout replaces the stale id on the next upgrade.
    // Other errors (network, rate limit) fall through unchanged.
    const NO_SUB = { error: 'No active subscription found. Choose a plan on the Pricing page to subscribe.' }
    try {
      const existing = await stripe.customers.retrieve(profile.stripe_customer_id)
      if (existing?.deleted) {
        console.warn('Portal: stored Stripe customer is deleted', profile.stripe_customer_id)
        return NextResponse.json(NO_SUB, { status: 404 })
      }
    } catch (err) {
      if (err?.code === 'resource_missing' || err?.statusCode === 404) {
        console.warn('Portal: stored Stripe customer not found', profile.stripe_customer_id)
        return NextResponse.json(NO_SUB, { status: 404 })
      }
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${request.headers.get('origin')}/dashboard`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Portal session error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
