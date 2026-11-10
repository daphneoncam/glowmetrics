// Single source of truth for user-facing lifecycle emails sent from the
// Next.js cron routes (trial reminders, subscription tips). Previously this
// send-and-log code was copied into four routes with the old "GlowMetrics"
// brand. The sender address is unchanged (noreply@camcashgrl.com is the
// address the daily admin emails already deliver from); only the display
// name is CamCash.

export const EMAIL_FROM = 'CamCash <noreply@camcashgrl.com>'
export const SITE_URL = 'https://www.camcashgrl.com'
export const SUPPORT_EMAIL = 'support@camcashgrl.com'

export async function logEmail(supabase, emailType, recipient, subject, status, resendResponse, errorMessage) {
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

// Returns true only when Resend accepted the email (response ok + id).
export async function sendEmail(supabase, emailType, recipient, subject, text) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[sendEmail] RESEND_API_KEY not set')
    await logEmail(supabase, emailType, recipient, subject, 'failed', null, 'Missing RESEND_API_KEY')
    return false
  }

  try {
    await logEmail(supabase, emailType, recipient, subject, 'pending', null, null)

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: recipient, subject, text }),
    })

    const resendResponse = await response.json().catch(() => ({}))

    if (response.ok && resendResponse.id) {
      await logEmail(supabase, emailType, recipient, subject, 'sent', resendResponse, null)
      return true
    }
    await logEmail(supabase, emailType, recipient, subject, 'failed', resendResponse, resendResponse.message || `HTTP ${response.status}`)
    console.error(`[sendEmail] Resend API error (${emailType}): ${resendResponse.message || response.status}`)
    return false
  } catch (e) {
    await logEmail(supabase, emailType, recipient, subject, 'failed', null, e.message)
    console.error(`[sendEmail] Exception (${emailType}): ${e.message}`)
    return false
  }
}

// Trial dates are shown in plain English, in UTC, so every recipient sees
// the same date the trial_ends_at column holds (e.g. "November 9, 2026").
export function formatTrialDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'soon'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// profiles has NO email column: emails live on the auth user. Selecting
// profiles.email made these cron queries fail every day (no trial or tip
// email was ever sent). Look the address up from auth with the service-role
// client instead. Returns null when the user or address can't be found.
export async function getUserEmail(supabase, userId) {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error) {
      console.error('[getUserEmail] lookup failed:', error.message)
      return null
    }
    return data?.user?.email || null
  } catch (e) {
    console.error('[getUserEmail] exception:', e.message)
    return null
  }
}
