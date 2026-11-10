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
  const threeDay = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const threeDayStart = new Date(threeDay.getFullYear(), threeDay.getMonth(), threeDay.getDate())
  const threeDayEnd = new Date(threeDayStart.getTime() + 24 * 60 * 60 * 1000)

  // Get users whose trials expire in exactly 3 days
  const { data: trialsExpiring3Days, error } = await supabase
    .from('profiles')
    .select('id, plan, trial_ends_at')
    .gte('trial_ends_at', threeDayStart.toISOString())
    .lt('trial_ends_at', threeDayEnd.toISOString())
    .eq('subscription_status', 'trialing')

  if (error) {
    console.error('[send-trial-expiry-3day] query failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  let emailsSent = 0
  let emailsFailed = 0

  if (trialsExpiring3Days?.length) {
    for (const user of trialsExpiring3Days) {
      const email = await getUserEmail(supabase, user.id)
      if (!email) { emailsFailed++; continue }
      // Trials are Stripe trials with a card on file: the subscription starts
      // automatically when the trial ends. The copy must say so (the old copy
      // told paying customers to "upgrade or lose access").
      const endDate = formatTrialDate(user.trial_ends_at)
      const subject = `Your CamCash Pro trial ends in 3 days (${endDate})`
      const text = `Hi there,

Your CamCash Pro free trial ends on ${endDate}.

When it ends, your Pro subscription starts automatically and the card you added at checkout will be charged for the plan you chose. You don't need to do anything to keep Pro.

If you'd rather not continue, you can cancel any time before ${endDate} from your CamCash dashboard (Subscription) and you won't be charged:
${SITE_URL}/dashboard?tab=subscription

Questions? Email us at ${SUPPORT_EMAIL}

The CamCash Team`

      const sent = await sendEmail(supabase, 'trial_expiry_3day', email, subject, text)
      if (sent) emailsSent++
      else emailsFailed++
    }
  }

  console.log(`[send-trial-expiry-3day] sent ${emailsSent} emails, ${emailsFailed} failed`)
  return NextResponse.json({
    success: true,
    trialsExpiring3Days: trialsExpiring3Days?.length || 0,
    emailsSent,
    emailsFailed,
  })
}
