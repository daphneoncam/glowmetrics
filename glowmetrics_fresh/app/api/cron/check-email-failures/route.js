import { NextResponse } from 'next/server'
import { requireCronAuth } from '../../../../lib/cron-auth'
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

export async function GET(req) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: failedEmails, error } = await supabase
    .from('email_logs')
    .select('id, email_type, recipient, subject, status, error_message, created_at')
    .eq('status', 'failed')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[check-email-failures] Database error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  if (!failedEmails?.length) {
    console.log('[check-email-failures] No failed emails in last 24 hours')
    return NextResponse.json({
      success: true,
      failedEmailCount: 0,
      alertSent: false,
    })
  }

  let alertText = '🚨 EMAIL DELIVERY FAILURES\n\n'
  alertText += `Report Date: ${new Date().toISOString().split('T')[0]}\n`
  alertText += '='.repeat(60) + '\n\n'
  alertText += `Failed Emails: ${failedEmails.length}\n\n`

  alertText += failedEmails.slice(0, 20).map(e =>
    `• ${e.email_type} - ${e.subject}\n  Error: ${e.error_message || 'Unknown error'}\n  Time: ${new Date(e.created_at).toISOString()}\n`
  ).join('')

  if (failedEmails.length > 20) {
    alertText += `\n... and ${failedEmails.length - 20} more\n`
  }

  alertText += '\n' + '='.repeat(60) + '\n'
  alertText += 'ACTION: Check RESEND_API_KEY is set in Vercel environment variables\n'
  alertText += 'Or verify noreply@camcashgrl.com domain is verified in Resend dashboard\n'
  alertText += '\nQuery all failures in database:\n'
  alertText += 'SELECT * FROM email_logs WHERE status=\'failed\' ORDER BY created_at DESC LIMIT 50;'

  const alertSent = await sendAlert(
    supabase,
    'email_failures',
    `🚨 Email Delivery Failures - ${new Date().toISOString().split('T')[0]}`,
    alertText
  )

  if (alertSent) {
    console.log('[check-email-failures] Email failure alert sent')
  }

  return NextResponse.json({
    success: true,
    failedEmailCount: failedEmails.length,
    alertSent,
  })
}
