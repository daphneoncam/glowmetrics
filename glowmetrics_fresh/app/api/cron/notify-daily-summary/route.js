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

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 1. New Signups
  const { data: newSignups } = await supabase
    .from('profiles')
    .select('id, created_at, plan, trial_ends_at')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // 2. New Subscriptions (conversions from free/trial to paid)
  const { data: newSubscriptions } = await supabase
    .from('subscription_events')
    .select('user_id, event_type, created_at, previous_plan, new_plan')
    .eq('event_type', 'subscription_started')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // 3. Trial Events
  const { data: trialEvents } = await supabase
    .from('free_trial_events')
    .select('user_id, event_type, created_at')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // 4. Subscription Cancellations
  const { data: cancellations } = await supabase
    .from('subscription_events')
    .select('user_id, event_type, created_at, previous_plan, new_plan')
    .eq('event_type', 'subscription_canceled')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // Build alert email
  // profiles has no email column: look emails up from auth for the people
  // listed in this report (previously the query failed and showed 0).
  await attachEmails(supabase, newSignups)

  let alertText = '📊 CAMCASH DAILY ACTIVITY SUMMARY\n\n'
  alertText += `Report Date: ${new Date().toISOString().split('T')[0]}\n`
  alertText += '='.repeat(50) + '\n\n'

  // New Signups Section
  alertText += `✨ NEW SIGNUPS: ${newSignups?.length || 0}\n`
  if (newSignups?.length) {
    alertText += newSignups.slice(0, 10).map(u =>
      `  • ${u.email} - Plan: ${u.plan} - Trial ends: ${u.trial_ends_at ? new Date(u.trial_ends_at).toLocaleDateString() : 'N/A'}`
    ).join('\n')
    if (newSignups.length > 10) {
      alertText += `\n  ... and ${newSignups.length - 10} more\n`
    }
  }
  alertText += '\n'

  // New Subscriptions Section
  alertText += `💰 NEW PAID SUBSCRIPTIONS: ${newSubscriptions?.length || 0}\n`
  if (newSubscriptions?.length) {
    alertText += newSubscriptions.slice(0, 10).map(s =>
      `  • User ${s.user_id} - ${s.previous_plan} → ${s.new_plan}`
    ).join('\n')
    if (newSubscriptions.length > 10) {
      alertText += `\n  ... and ${newSubscriptions.length - 10} more\n`
    }
  }
  alertText += '\n'

  // Trial Events Section
  const trialBreakdown = {}
  trialEvents?.forEach(e => {
    trialBreakdown[e.event_type] = (trialBreakdown[e.event_type] || 0) + 1
  })
  alertText += `🎯 TRIAL ACTIVITY:\n`
  Object.entries(trialBreakdown).forEach(([type, count]) => {
    alertText += `  • ${type.replace(/_/g, ' ')}: ${count}\n`
  })
  alertText += '\n'

  // Cancellations Section
  alertText += `❌ SUBSCRIPTION CANCELLATIONS: ${cancellations?.length || 0}\n`
  if (cancellations?.length) {
    alertText += cancellations.slice(0, 10).map(c =>
      `  • User ${c.user_id} - ${c.previous_plan} → ${c.new_plan}`
    ).join('\n')
    if (cancellations.length > 10) {
      alertText += `\n  ... and ${cancellations.length - 10} more\n`
    }
  }
  alertText += '\n'

  // Summary stats
  const totalRevenue = newSubscriptions?.length || 0
  alertText += '='.repeat(50) + '\n'
  alertText += `SUMMARY:\n`
  alertText += `  New Users: ${newSignups?.length || 0}\n`
  alertText += `  Paid Conversions: ${totalRevenue}\n`
  alertText += `  Cancellations: ${cancellations?.length || 0}\n`
  alertText += `  Net Change: +${(totalRevenue - (cancellations?.length || 0))}\n`

  await sendAlert(
    supabase,
    'daily_summary',
    `📊 CamCash Daily Summary - ${new Date().toISOString().split('T')[0]}`,
    alertText
  )

  console.log('[cron/notify-daily-summary] Daily summary sent')
  return NextResponse.json({
    success: true,
    newSignups: newSignups?.length || 0,
    newSubscriptions: newSubscriptions?.length || 0,
    trialEvents: trialEvents?.length || 0,
    cancellations: cancellations?.length || 0,
  })
}
