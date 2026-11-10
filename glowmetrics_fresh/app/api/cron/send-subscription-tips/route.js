import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, getUserEmail } from '../../../../lib/email/sendEmail'
import { TIPS, TIP_INTERVAL_DAYS } from '../../../../lib/email/subscriptionTips'

export const dynamic = 'force-dynamic'

// Weekly feature tips for subscribers. The daily cron calls this route every
// day; each subscriber receives at most one tip per 7 days (checked against
// email_logs), and tips rotate in order so nobody gets the same one twice in
// a row. Every tip describes a feature that exists on the Pro plan as listed
// on /pricing; no steps, menus or numbers are invented.
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Active subscribers (paid + trialing, excluding free). Unchanged audience.
  const { data: activeSubscribers, error } = await supabase
    .from('profiles')
    .select('id, plan, subscription_status')
    .in('subscription_status', ['active', 'trialing'])
    .neq('plan', 'free')

  if (error) {
    console.error('[send-subscription-tips] query failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const cutoff = new Date(Date.now() - TIP_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let emailsSent = 0
  let emailsFailed = 0
  let skippedRecent = 0

  for (const user of activeSubscribers || []) {
    const email = await getUserEmail(supabase, user.id)
    if (!email) { emailsFailed++; continue }

    const { data: history, error: historyError } = await supabase
      .from('email_logs')
      .select('created_at')
      .eq('email_type', 'subscription_tip')
      .eq('recipient', email)
      .eq('status', 'sent')
      .order('created_at', { ascending: false })

    // If the history can't be read, skip rather than risk sending daily.
    if (historyError) {
      console.error('[send-subscription-tips] history read failed:', historyError.message)
      emailsFailed++
      continue
    }
    if (history?.length && history[0].created_at > cutoff) {
      skippedRecent++
      continue
    }

    const tip = TIPS[(history?.length || 0) % TIPS.length]
    const sent = await sendEmail(supabase, 'subscription_tip', email, tip.subject, tip.text)
    if (sent) emailsSent++
    else emailsFailed++
  }

  console.log(`[send-subscription-tips] sent ${emailsSent}, skipped ${skippedRecent} (tip within ${TIP_INTERVAL_DAYS} days), failed ${emailsFailed} (subscribers: ${activeSubscribers?.length || 0})`)
  return NextResponse.json({
    success: true,
    activeSubscribers: activeSubscribers?.length || 0,
    emailsSent,
    emailsFailed,
    skippedRecent,
  })
}
