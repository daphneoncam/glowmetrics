import { NextResponse } from 'next/server'
import { requireCronAuth } from '../../../../lib/cron-auth'
import { createClient } from '@supabase/supabase-js'

// Cron endpoint — must run fresh on every invocation (real DB state, never
// a build-time snapshot). Without this, Next.js's build-time static
// optimization for GET route handlers runs this at `next build` time,
// where SUPABASE_SERVICE_ROLE_KEY isn't set, and the build fails with
// "supabaseKey is required" instead of just running normally at runtime.
export const dynamic = 'force-dynamic'

// Downgrades goodwill Pro grants (the Sep 2026 apology for the Stripe
// webhook bug — see app/api/stripe/webhook/route.js) back to free once
// their trial_ends_at passes. Only ever touches subscription_status =
// 'goodwill_trial' rows: that value is set nowhere else in the codebase, so
// this can never downgrade a real Stripe-driven subscription (those use
// 'active'/'trialing'/'canceled'/'none' — see the webhook handler).
export async function GET(req) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: expired, error: selectError } = await supabase
    .from('profiles')
    .select('id')
    .eq('subscription_status', 'goodwill_trial')
    .lt('trial_ends_at', new Date().toISOString())

  if (selectError) {
    console.error('[cron/expire-goodwill-trials] select failed:', selectError.message)
    return NextResponse.json({ success: false, error: selectError.message }, { status: 500 })
  }

  if (!expired?.length) {
    return NextResponse.json({ success: true, downgraded: 0 })
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ plan: 'free', subscription_status: 'none', trial_ends_at: null })
    .eq('subscription_status', 'goodwill_trial')
    .lt('trial_ends_at', new Date().toISOString())

  if (updateError) {
    console.error('[cron/expire-goodwill-trials] update failed:', updateError.message)
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  console.log(`[cron/expire-goodwill-trials] downgraded ${expired.length} expired goodwill grant(s):`, expired.map(u => u.id))
  return NextResponse.json({ success: true, downgraded: expired.length, userIds: expired.map(u => u.id) })
}
