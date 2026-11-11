import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { attachEmails } from '../../../../lib/email/sendEmail'

// Standard monthly plan price (Stripe price_1UOVqL…). Estimate only — assumes every conversion is monthly.
const MONTHLY_PRICE_USD = 9.99

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

  // 1. Trial → Paid Conversions (SUCCESS)
  const { data: successfulConversions } = await supabase
    .from('subscription_events')
    .select('user_id, event_type, created_at, new_plan')
    .eq('event_type', 'subscription_started')
    .in('new_plan', ['pro', 'premium', 'standard'])
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // 2. Failed Conversions (user tried to upgrade but webhook/payment failed)
  const { data: failedConversions } = await supabase
    .from('profiles')
    .select('id, plan, subscription_status, stripe_subscription_id, trial_ends_at')
    .eq('subscription_status', 'trialing')
    .lt('trial_ends_at', new Date().toISOString())
    .order('trial_ends_at', { ascending: false })

  // 3. Trial Abandonments (trial expired without conversion)
  const { data: abandonedTrials } = await supabase
    .from('free_trial_events')
    .select('user_id, event_type, created_at')
    .eq('event_type', 'trial_abandoned')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // 4. Cancellations within trial period (churned before paying)
  const { data: earlyChurns } = await supabase
    .from('subscription_events')
    .select('user_id, event_type, created_at, previous_plan')
    .eq('event_type', 'subscription_canceled')
    .eq('previous_plan', 'trialing')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  // profiles has no email column: look emails up from auth for the people
  // listed in this report (previously the query failed and showed 0).
  await attachEmails(supabase, failedConversions)

  let alertText = '💳 SUBSCRIPTION CONVERSION REPORT\n\n'
  alertText += `Report Date: ${new Date().toISOString().split('T')[0]}\n`
  alertText += '='.repeat(60) + '\n\n'

  // SUCCESS: Conversions
  alertText += `✅ SUCCESSFUL CONVERSIONS: ${successfulConversions?.length || 0}\n`
  if (successfulConversions?.length) {
    const totalMRR = (successfulConversions.length * MONTHLY_PRICE_USD).toFixed(2)
    alertText += `   Revenue: $${totalMRR}/month (${successfulConversions.length} × $${MONTHLY_PRICE_USD})\n\n`
    alertText += successfulConversions.slice(0, 15).map(c =>
      `   • User ${c.user_id} - ${c.new_plan} - ${new Date(c.created_at).toLocaleString()}`
    ).join('\n')
    if (successfulConversions.length > 15) {
      alertText += `\n   ... and ${successfulConversions.length - 15} more\n`
    }
  }
  alertText += '\n'

  // WARNING: Failed Conversions (stale trials with no active subscription)
  alertText += `⚠️ POTENTIAL FAILED CONVERSIONS: ${failedConversions?.length || 0}\n`
  if (failedConversions?.length) {
    alertText += `   These trials expired but user never converted to paid\n`
    alertText += `   Possible causes: Payment failed, webhook error, user didn't complete checkout\n\n`
    alertText += failedConversions.slice(0, 10).map(f =>
      `   • ${f.email} - Trial ended: ${new Date(f.trial_ends_at).toLocaleDateString()}`
    ).join('\n')
    if (failedConversions.length > 10) {
      alertText += `\n   ... and ${failedConversions.length - 10} more\n`
    }
    alertText += `\n   ACTION: Check webhook_events table for failures:\n`
    alertText += `   SELECT * FROM webhook_events WHERE status != 'success'\n`
    alertText += `   AND event_type LIKE '%subscription%' AND created_at >= NOW() - INTERVAL '48 hours'\n`
  }
  alertText += '\n'

  // INFO: Abandonments
  alertText += `❌ TRIAL ABANDONMENTS: ${abandonedTrials?.length || 0}\n`
  if (abandonedTrials?.length) {
    alertText += `   Users who never paid or converted\n`
  }
  alertText += '\n'

  // INFO: Early Churns
  alertText += `🚪 CHURNED BEFORE PAYING: ${earlyChurns?.length || 0}\n`
  if (earlyChurns?.length) {
    alertText += `   Canceled trial without attempting upgrade\n`
  }
  alertText += '\n'

  // Summary
  alertText += '='.repeat(60) + '\n'
  alertText += 'SUMMARY:\n'
  alertText += `  Conversions: ${successfulConversions?.length || 0}\n`
  alertText += `  Failed/Stale: ${failedConversions?.length || 0}\n`
  alertText += `  Abandonments: ${abandonedTrials?.length || 0}\n`
  alertText += `  Early Churns: ${earlyChurns?.length || 0}\n`
  const projectedMRR = ((successfulConversions?.length || 0) * MONTHLY_PRICE_USD).toFixed(2)
  alertText += `  Projected MRR (from new conversions): $${projectedMRR}\n`

  await sendAlert(
    supabase,
    'conversion_report',
    `💳 Conversion Report - ${new Date().toISOString().split('T')[0]}`,
    alertText
  )

  console.log('[cron/notify-conversions] Conversion alerts sent')
  return NextResponse.json({
    success: true,
    successfulConversions: successfulConversions?.length || 0,
    failedConversions: failedConversions?.length || 0,
    abandonedTrials: abandonedTrials?.length || 0,
    earlyChurns: earlyChurns?.length || 0,
  })
}
