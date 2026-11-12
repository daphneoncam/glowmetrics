import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
        from: 'GlowMetrics <noreply@camcashgrl.com>',
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

  // Check for failures in the last 24 hours
  const { data: failures, error } = await supabase
    .from('webhook_events')
    .select('stripe_event_id, event_type, status, error_message, created_at')
    .neq('status', 'success')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[cron/check-webhook-failures] query failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  if (!failures?.length) {
    return NextResponse.json({ success: true, failures_found: 0 })
  }

  // Group failures by type
  const failuresByStatus = {}
  failures.forEach(f => {
    if (!failuresByStatus[f.status]) {
      failuresByStatus[f.status] = []
    }
    failuresByStatus[f.status].push(f)
  })

  // Build alert email
  const failureDetails = Object.entries(failuresByStatus)
    .map(([status, events]) => {
      const examples = events.slice(0, 3).map(e =>
        `  - ${e.event_type}: ${e.error_message || '(no error message)'} (${new Date(e.created_at).toISOString()})`
      ).join('\n')
      return `${status.toUpperCase()} (${events.length} failures):\n${examples}${events.length > 3 ? `\n  ... and ${events.length - 3} more` : ''}`
    })
    .join('\n\n')

  const alertSubject = `🚨 CRITICAL: ${failures.length} Stripe Webhook Failures in Last 24h`
  const alertText = `WARNING: Your Stripe webhook processing had failures in the last 24 hours.\n\nTotal Failures: ${failures.length}\n\nBreakdown:\n${failureDetails}\n\nCheck your webhook_events table for full details:\nSELECT * FROM webhook_events WHERE status != 'success' AND created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC;`

  await sendAlert(supabase, 'webhook_failures', alertSubject, alertText)

  console.log(`[cron/check-webhook-failures] found ${failures.length} failures, alert sent`)
  return NextResponse.json({ success: true, failures_found: failures.length, grouped: failuresByStatus })
}
