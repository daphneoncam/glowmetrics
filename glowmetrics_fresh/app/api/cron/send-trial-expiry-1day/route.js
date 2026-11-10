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
  const oneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const oneDayStart = new Date(oneDay.getFullYear(), oneDay.getMonth(), oneDay.getDate())
  const oneDayEnd = new Date(oneDayStart.getTime() + 24 * 60 * 60 * 1000)

  // Get users whose trials expire in exactly 1 day
  const { data: trialsExpiring1Day, error } = await supabase
    .from('profiles')
    .select('id, plan, trial_ends_at')
    .gte('trial_ends_at', oneDayStart.toISOString())
    .lt('trial_ends_at', oneDayEnd.toISOString())
    .eq('subscription_status', 'trialing')

  if (error) {
    console.error('[send-trial-expiry-1day] query failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  let emailsSent = 0
  let emailsFailed = 0

  if (trialsExpiring1Day?.length) {
    for (const user of trialsExpiring1Day) {
      const email = await getUserEmail(supabase, user.id)
      if (!email) { emailsFailed++; continue }
      const endDate = formatTrialDate(user.trial_ends_at)
      const subject = 'Your CamCash Pro trial ends tomorrow'
      const text = `Hi there,

A quick reminder: your CamCash Pro free trial ends tomorrow, ${endDate}.

Your Pro subscription will then start automatically and the card you added at checkout will be charged for the plan you chose, so you keep full history, every platform, Stream Planner and Money Map without interruption.

If you'd rather not continue, cancel before ${endDate} from your CamCash dashboard (Subscription) and you won't be charged:
${SITE_URL}/dashboard?tab=subscription

Questions? Email us at ${SUPPORT_EMAIL}

The CamCash Team`

      const sent = await sendEmail(supabase, 'trial_expiry_1day', email, subject, text)
      if (sent) emailsSent++
      else emailsFailed++
    }
  }

  console.log(`[send-trial-expiry-1day] sent ${emailsSent} emails, ${emailsFailed} failed`)
  return NextResponse.json({
    success: true,
    trialsExpiring1Day: trialsExpiring1Day?.length || 0,
    emailsSent,
    emailsFailed,
  })
}
