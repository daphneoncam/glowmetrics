import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

// Source of the deployed `send-live-mode-guide-email` Edge Function, now kept
// in the repo. Called once per user by public.send_live_mode_guide_batch()
// (daily pg_cron job, users 2–6 days after signup).
//
// 2026-11-06: the batch used to mark profiles.live_mode_guide_sent_at BEFORE
// this function ran (net.http_post is fire-and-forget), and this function
// returned success even when Resend rejected the email, so a failed send was
// never retried. Now this function marks the profile only after Resend
// accepts the email, logs every attempt to email_logs, and returns a non-2xx
// status on failure. The email content below is unchanged.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const EMAIL_TYPE = 'live_mode_guide'
const SUBJECT = 'How Live Mode Works 🎥 — free on your first platform'

const BLOCKED_DOMAINS = [
  'yopmail.com', 'mailinator.com', 'guerrillamail.com',
  'tempmail.com', 'throwaway.email', 'sharklasers.com',
  'fsd.ws', 'example.com', 'test.com', 'fake.com'
]

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) return false
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  if (BLOCKED_DOMAINS.includes(domain)) return false
  const tld = domain.split('.').pop()
  if (!tld || tld.length < 2) return false
  return true
}

const STEPS = [
  { n: 1, icon: '🧩', title: 'Download the Extension', body: "Install the CamCashGrl Live Mode extension from the Chrome Web Store. It's free!" },
  { n: 2, icon: '🔗', title: 'Connect Your Cam Account', body: 'Connect your platform account securely inside the extension.' },
  { n: 3, icon: '🟢', title: 'Enable Live Mode', body: 'Click "Start Live Mode" before you go live. We\'ll start tracking your session in real-time.' },
  { n: 4, icon: '💬', title: 'Get Real-Time Coaching', body: 'Receive smart tips and nudges based on your pace, viewers, tippers, and stream goals.' },
  { n: 5, icon: '🎯', title: 'Stay On Track & Hit Goals', body: 'Live Mode helps you make better decisions in the moment to maximize your earnings.' },
  { n: 6, icon: '📊', title: 'Sync Your Data to Dashboard', badge: 'FREE — 1 PLATFORM', body: 'Your tips and analytics sync to your CamCashGrl dashboard automatically — free on your first platform. Track a second platform with Live Mode by upgrading to Pro.' },
]

const LIVE_MODE_GUIDE_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#050713;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">

  <div style="text-align:center;margin-bottom:8px;">
    <span style="font-size:22px;">👑</span>
    <span style="font-size:18px;font-weight:800;color:#F1F5F9;font-style:italic;margin-left:6px;">CamCashGrl</span>
  </div>

  <div style="text-align:center;margin-bottom:28px;">
    <h1 style="margin:0;font-size:32px;font-weight:900;line-height:1.15;">
      <span style="color:#F1F5F9;">HOW</span><br/>
      <span style="background:linear-gradient(90deg,#16F4FF 0%,#7C5CFF 48%,#FF2BAE 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">LIVE MODE WORKS</span>
      <span>💗</span>
    </h1>
    <p style="margin:14px 0 0;font-size:14px;color:#D7D9EA;line-height:1.6;">
      Real-time coaching. Smarter decisions.<br/>
      <span style="color:#FF2BAE;font-weight:700;">More tips. More tokens. More you.</span>
    </p>
  </div>

  <div style="margin-bottom:24px;border-radius:18px;background:rgba(13,17,38,0.85);border:1px solid rgba(22,244,255,0.28);padding:20px;">
    <div style="display:inline-block;padding:4px 12px;border-radius:20px;background:rgba(255,43,174,0.15);border:1px solid rgba(255,43,174,0.4);color:#FF2BAE;font-size:11px;font-weight:800;letter-spacing:0.06em;margin-bottom:14px;">🔴 LIVE MODE</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      <tr>
        <td style="padding:0;">
          <div style="font-size:10px;color:#8D93AA;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Earnings</div>
          <div style="font-size:20px;font-weight:900;color:#16F4FF;">$42<span style="font-size:12px;color:#8D93AA;font-weight:600;">/hr</span></div>
        </td>
        <td style="padding:0;">
          <div style="font-size:10px;color:#8D93AA;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Tip Rate</div>
          <div style="font-size:20px;font-weight:900;color:#F1F5F9;">162<span style="font-size:12px;color:#8D93AA;font-weight:600;"> t/min</span></div>
        </td>
        <td style="padding:0;">
          <div style="font-size:10px;color:#8D93AA;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Goal Progress</div>
          <div style="font-size:20px;font-weight:900;color:#FF2BAE;">68%</div>
        </td>
      </tr>
    </table>
    <div style="border-radius:12px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.35);padding:12px 14px;">
      <div style="font-size:11px;font-weight:800;color:#7C5CFF;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">💎 Coaching</div>
      <div style="font-size:13px;color:#F1F5F9;font-weight:700;">Your biggest spender is back in the room! 💗</div>
      <div style="font-size:12px;color:#D7D9EA;margin-top:2px;">Say hi and engage</div>
    </div>
  </div>

  <div style="border-radius:14px;background:rgba(22,244,255,0.08);border:1px solid rgba(22,244,255,0.3);padding:16px 18px;margin-bottom:28px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#F1F5F9;line-height:1.5;">
      <strong style="color:#16F4FF;">⚡ LIVE MODE GIVES YOU REAL-TIME DATA</strong> + personalized coaching so you can make more while you're live.
    </p>
  </div>

  ${STEPS.map(s => `
  <div style="margin-bottom:14px;border-radius:16px;background:rgba(13,17,38,0.72);border:1px solid rgba(255,255,255,0.09);padding:18px 20px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:36px;vertical-align:top;">
          <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#16F4FF,#7C5CFF);color:#fff;font-size:13px;font-weight:900;text-align:center;line-height:26px;">${s.n}</div>
        </td>
        <td style="vertical-align:top;">
          <div style="font-size:14px;font-weight:800;color:#F1F5F9;">${s.icon} ${s.title}${s.badge ? ` <span style="font-size:10px;font-weight:800;color:#FFC857;letter-spacing:0.06em;">${s.badge}</span>` : ''}</div>
          <div style="font-size:13px;color:#8D93AA;margin-top:4px;line-height:1.5;">${s.body}</div>
        </td>
      </tr>
    </table>
  </div>`).join('')}

  <div style="margin-bottom:14px;border-radius:16px;background:rgba(216,61,255,0.08);border:1px solid rgba(216,61,255,0.3);padding:18px 20px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#D83DFF;">🔌 Works With Lovense</p>
    <p style="margin:0;font-size:13px;color:#D7D9EA;line-height:1.5;">Live Mode works simultaneously with Lovense and other toys. No conflicts. No interruptions.</p>
  </div>

  <div style="margin-bottom:28px;border-radius:16px;background:rgba(255,200,87,0.08);border:1px solid rgba(255,200,87,0.3);padding:18px 20px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#FFC857;">👑 Free On Your First Platform</p>
    <p style="margin:0;font-size:13px;color:#D7D9EA;line-height:1.5;">Real-time coaching and automatic tip tracking are free for everyone on one platform. Upgrading to Pro unlocks Live Mode on every platform you work, plus full history, insights & advanced analytics.</p>
  </div>

  <div style="border-radius:16px;border:1px solid rgba(255,43,174,0.35);padding:20px 24px;margin-bottom:32px;text-align:center;">
    <p style="margin:0;font-size:14px;color:#F1F5F9;line-height:1.6;">Live Mode is like having a personal coach in your corner — helping you earn more, stress less, and slay every show. 💗</p>
  </div>

  <div style="text-align:center;margin-bottom:16px;">
    <a href="https://www.camcashgrl.com/live" style="display:inline-block;padding:16px 48px;border-radius:12px;background:linear-gradient(90deg,#16F4FF 0%,#7C5CFF 48%,#FF2BAE 100%);color:#fff;font-size:16px;font-weight:800;text-decoration:none;">
      Enable Live Mode →
    </a>
  </div>

  <div style="text-align:center;padding-top:24px;border-top:1px solid rgba(255,255,255,0.08);">
    <p style="margin:0 0 6px;font-size:12px;color:#5E647C;">
      Questions? We're here for you. <a href="mailto:support@camcashgrl.com" style="color:#8D93AA;">support@camcashgrl.com</a>
    </p>
    <p style="margin:0;font-size:12px;color:#5E647C;">
      👑 <a href="https://www.camcashgrl.com" style="color:#8D93AA;text-decoration:none;">CamCashGrl.com</a>
    </p>
  </div>

</div>
</body>
</html>
`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function adminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function logEmail(admin: ReturnType<typeof adminClient>, recipient: string, status: string, resendResponse: unknown, errorMessage: string | null) {
  if (!admin) return
  const { error } = await admin.from('email_logs').insert({
    email_type: EMAIL_TYPE,
    recipient,
    subject: SUBJECT,
    status,
    resend_response: resendResponse ?? null,
    error_message: errorMessage,
  })
  if (error) console.error('[live-mode-guide] email_logs insert failed:', error.message)
}

serve(async (req) => {
  const admin = adminClient()
  let email = ''
  try {
    const body = await req.json()
    email = body.email || body.record?.email
    const userId: string | undefined = body.user_id

    if (!email) return json({ error: 'No email provided' }, 400)

    if (!isValidEmail(email)) {
      return json({ skipped: true, reason: 'invalid email' })
    }

    if (!RESEND_API_KEY) {
      await logEmail(admin, email, 'failed', null, 'Missing RESEND_API_KEY')
      return json({ success: false, error: 'Missing RESEND_API_KEY' }, 500)
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CamCashGrl <hello@camcashgrl.com>',
        to: email,
        subject: SUBJECT,
        html: LIVE_MODE_GUIDE_HTML,
      })
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data?.id) {
      const message = data?.message || `Resend HTTP ${res.status}`
      await logEmail(admin, email, 'failed', data, message)
      // Not marked as sent: the daily batch retries while the user is still
      // inside the 2–6 day window.
      return json({ success: false, error: message }, 502)
    }

    await logEmail(admin, email, 'sent', data, null)

    // Mark delivered only now, and only when user_id really belongs to this
    // email address (profiles has no email column, so check the auth user).
    if (admin && userId) {
      const { data: authUser } = await admin.auth.admin.getUserById(userId)
      if (authUser?.user?.email?.toLowerCase() === String(email).toLowerCase()) {
        const { error } = await admin
          .from('profiles')
          .update({ live_mode_guide_sent_at: new Date().toISOString() })
          .eq('id', userId)
          .is('live_mode_guide_sent_at', null)
        if (error) console.error('[live-mode-guide] mark-sent failed:', error.message)
      } else {
        console.error('[live-mode-guide] user_id/email mismatch; not marking', userId)
      }
    }

    return json({ success: true, data })
  } catch (err) {
    if (email) await logEmail(admin, email, 'failed', null, (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
