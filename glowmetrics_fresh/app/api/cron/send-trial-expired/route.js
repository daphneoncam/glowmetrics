import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, getUserEmail, formatTrialDate, SITE_URL, SUPPORT_EMAIL } from '../../../../lib/email/sendEmail'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  // Get users whose trials expired today
  const { data: trialsExpiredToday, error } = await supabase
    .from('profiles')
    .select('id, plan, trial_ends_at')
    .gte('trial_ends_at', today.toISOString())
    .lt('trial_ends_at', tomorrow.toISOString())
    .eq('subscription_status', 'trialing')

  if (error) {
    console.error('[send-trial-expired] query failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  let emailsSent = 0
  let emailsFailed = 0

  if (trialsExpiredToday?.length) {
    for (const user of trialsExpiredToday) {
      const email = await getUserEmail(supabase, user.id)
      if (!email) { emailsFailed++; continue }
      // This route selects trials ending TODAY that are still trialing, so
      // the subscription is about to start; it is not a lapsed account. The
      // old copy ("your account is on a free plan, reactivate") was false.
      const endDate = formatTrialDate(user.trial_ends_at)
      const subject = 'Your CamCash Pro trial ends today'
      const text = `Hi there,

Your CamCash Pro free trial ends today, ${endDate}.

Your Pro subscription starts automatically and the card you added at checkout will be charged for the plan you chose. Your data, history and settings stay exactly as they are.

You can manage or cancel your subscription any time from your CamCash dashboard (Subscription):
${SITE_URL}/dashboard?tab=subscription

Thank you for trying CamCash Pro. Questions? Email us at ${SUPPORT_EMAIL}

The CamCash Team`

      const sent = await sendEmail(supabase, 'trial_expired', email, subject, text)
      if (sent) emailsSent++
      else emailsFailed++
    }
  }

  console.log(`[send-trial-expired] sent ${emailsSent} emails, ${emailsFailed} failed`)
  return NextResponse.json({
    success: true,
    trialsExpiredToday: trialsExpiredToday?.length || 0,
    emailsSent,
    emailsFailed,
  })
}
