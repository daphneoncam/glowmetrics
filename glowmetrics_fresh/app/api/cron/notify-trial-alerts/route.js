import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { attachEmails } from '../../../../lib/email/sendEmail'

export const dynamic = 'force-dynamic'

async function logEmail(supabase, emailType, recipient, subject, status, resendResponse, errorMessage) {
  try {
    await supabase.from('email_logs').insert({
      email_type: emailType,
      recipient,
      subject,
      status,
      resend_response: resendResponse,
      error_message: errorMessage,
    })
  } catch (err) {
    console.error('[logEmail] Failed to log email:', err.message)
  }
}

async function sendAlert(supabase, emailType, subject, text) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[sendAlert] RESEND_API_KEY not set')
    await logEmail(supabase, emailType, 'daphneoncam@gmail.com', subject, 'failed', null, 'Missing RESEND_API_KEY')
    return false
  }

  try {
    await logEmail(supabase, emailType, 'daphneoncam@gmail.com', subject, 'pending', null, null)

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CamCash <noreply@camcashgrl.com>',
        to: 'daphneoncam@gmail.com',
        subject,
        text,
      }),
    })

    const resendResponse = await response.json()

    if (response.ok && resendResponse.id) {
      await logEmail(supabase, emailType, 'daphneoncam@gmail.com', subject, 'sent', resendResponse, null)
      console.log(`[sendAlert] Email sent successfully: ${resendResponse.id}`)
      return true
    } else {
      await logEmail(supabase, emailType, 'daphneoncam@gmail.com', subject, 'failed', resendResponse, resendResponse.message || 'Unknown error')
      console.error(`[sendAlert] Resend API error: ${resendResponse.message}`)
      return false
    }
  } catch (e) {
    await logEmail(supabase, emailType, 'daphneoncam@gmail.com', subject, 'failed', null, e.message)
    console.error(`[sendAlert] Exception: ${e.message}`)
    return false
  }
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const twoDaysFromNow = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000)

  // 1. Trials expiring TODAY (should convert or expire)
  const { data: trialsExpiringToday } = await supabase
    .from('profiles')
    .select('id, plan, trial_ends_at, subscription_status')
    .gte('trial_ends_at', today.toISOString())
    .lt('trial_ends_at', tomorrow.toISOString())
    .eq('subscription_status', 'trialing')

  // 2. Trials expiring in NEXT 2 DAYS (heads up)
  const { data: trialsExpiringsSoon } = await supabase
    .from('profiles')
    .select('id, plan, trial_ends_at, subscription_status')
    .gte('trial_ends_at', tomorrow.toISOString())
    .lt('trial_ends_at', twoDaysFromNow.toISOString())
    .eq('subscription_status', 'trialing')

  // 3. Trials that expired but still showing as trialing (data sync issue)
  const { data: staleTrials } = await supabase
    .from('profiles')
    .select('id, plan, trial_ends_at, subscription_status')
    .lt('trial_ends_at', today.toISOString())
    .eq('subscription_status', 'trialing')
    .limit(50)

  // profiles has no email column: look emails up from auth for the people
  // listed in this report (previously the query failed and showed 0).
  await attachEmails(supabase, staleTrials)
  await attachEmails(supabase, trialsExpiringToday)
  await attachEmails(supabase, trialsExpiringsSoon)

  let alertText = ''
  let hasCritical = false

  // CRITICAL: Trials that expired but still active
  if (staleTrials?.length) {
    hasCritical = true
    alertText += '🚨 CRITICAL: STALE TRIALS (Should have expired)\n'
    alertText += '='.repeat(50) + '\n'
    alertText += `Count: ${staleTrials.length}\n\n`
    alertText += staleTrials.slice(0, 20).map(t => {
      const daysOverdue = Math.floor((now - new Date(t.trial_ends_at)) / (24 * 60 * 60 * 1000))
      return `  • ${t.email}\n    Trial ended: ${new Date(t.trial_ends_at).toLocaleDateString()}\n    Days overdue: ${daysOverdue}\n`
    }).join('')
    if (staleTrials.length > 20) {
      alertText += `  ... and ${staleTrials.length - 20} more\n`
    }
    alertText += '\nACTION: These users should be downgraded to free plan immediately\n'
    alertText += 'SQL: UPDATE profiles SET plan=\'free\', subscription_status=\'canceled\'\n'
    alertText += '     WHERE subscription_status=\'trialing\' AND trial_ends_at < NOW();\n\n'
  }

  // WARNING: Trials expiring TODAY
  if (trialsExpiringToday?.length) {
    alertText += '⚠️ TRIALS EXPIRING TODAY (Conversion deadline)\n'
    alertText += '='.repeat(50) + '\n'
    alertText += `Count: ${trialsExpiringToday.length}\n\n`
    alertText += trialsExpiringToday.slice(0, 20).map(t =>
      `  • ${t.email} - Expires: ${new Date(t.trial_ends_at).toLocaleString()}\n`
    ).join('')
    if (trialsExpiringToday.length > 20) {
      alertText += `  ... and ${trialsExpiringToday.length - 20} more\n`
    }
    alertText += '\nACTION: Monitor these for payment processing\n'
    alertText += 'Check webhook_events table for conversion failures\n\n'
  }

  // INFO: Trials expiring in next 2 days
  if (trialsExpiringsSoon?.length) {
    alertText += '📧 TRIALS EXPIRING SOON (Next 48 hours)\n'
    alertText += '='.repeat(50) + '\n'
    alertText += `Count: ${trialsExpiringsSoon.length}\n\n`
    alertText += trialsExpiringsSoon.slice(0, 20).map(t =>
      `  • ${t.email} - Expires: ${new Date(t.trial_ends_at).toLocaleString()}\n`
    ).join('')
    if (trialsExpiringsSoon.length > 20) {
      alertText += `  ... and ${trialsExpiringsSoon.length - 20} more\n`
    }
    alertText += '\nACTION: These will convert or expire in next 48 hours\n\n'
  }

  // Only send alert if there's critical data or expiring trials
  if (alertText) {
    const subject = hasCritical
      ? `🚨 CRITICAL: Trial Sync Issues - ${staleTrials?.length || 0} stale trials`
      : `⚠️ Trial Alerts - ${trialsExpiringToday?.length || 0} expiring today`

    await sendAlert(supabase, 'trial_alerts', subject, alertText)
    console.log('[cron/notify-trial-alerts] Trial alerts sent')
  }

  return NextResponse.json({
    success: true,
    trialsExpiringToday: trialsExpiringToday?.length || 0,
    trialsExpiringsSoon: trialsExpiringsSoon?.length || 0,
    staleTrials: staleTrials?.length || 0,
    alertSent: !!alertText,
  })
}
