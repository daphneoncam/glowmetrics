import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

// Source of the deployed `send-pro-trial-email` Edge Function, now kept in
// the repo. Nothing calls it automatically. Email content is unchanged; the
// claim link (/dashboard?promo=THANKYOU14) is redeemed by
// app/dashboard/PromoRedeemer.js via public.redeem_promo_code().
//
// 2026-11-11: calls must carry the shared secret (x-camcash-secret header);
// anything else is refused. Previously anyone with the URL could send it.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CODE = 'THANKYOU14'

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

function html(claimUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#050713;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">

  <div style="text-align:center;margin-bottom:8px;">
    <span style="font-size:22px;">👑</span>
    <span style="font-size:18px;font-weight:800;color:#F1F5F9;font-style:italic;margin-left:6px;">CamCashGrl</span>
  </div>

  <div style="text-align:center;margin:20px 0 28px;">
    <div style="font-size:56px;line-height:1;margin-bottom:16px;">🎁</div>
    <h1 style="margin:0;font-size:28px;font-weight:900;line-height:1.2;">
      <span style="color:#F1F5F9;">A THANK-YOU GIFT:</span><br/>
      <span style="background:linear-gradient(90deg,#7C5CFF 0%,#D83DFF 55%,#FF2BAE 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">2 WEEKS OF CREATOR PRO</span>
    </h1>
    <p style="margin:16px 0 0;font-size:15px;color:#D7D9EA;">On the house — no card required.</p>
  </div>

  <p style="font-size:15px;color:#F1F5F9;font-weight:700;margin:0 0 12px;">Hey, 💗</p>
  <p style="font-size:14px;color:#D7D9EA;line-height:1.6;margin:0 0 12px;">
    You're one of our early CamCashGrl users, and we wanted to say thanks the best way we know how —
    <strong style="color:#FFC857;">14 days of Creator Pro, completely free.</strong>
  </p>
  <p style="font-size:14px;color:#D7D9EA;line-height:1.6;margin:0 0 24px;">
    Track every platform you work, see your full permanent tip history, and unlock Stream Planner, Money Map, and your full best-time analysis — no strings attached.
  </p>

  <div style="border-radius:18px;background:rgba(13,17,38,0.85);border:1px solid rgba(124,92,255,0.3);padding:22px 24px;margin-bottom:28px;">
    <p style="margin:0 0 16px;font-size:12px;font-weight:800;color:#16F4FF;text-transform:uppercase;letter-spacing:0.08em;">With Pro, you get:</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 8px 8px 0;font-size:13px;color:#F1F5F9;vertical-align:top;width:50%;">📶 Unlimited platform tracking</td>
        <td style="padding:8px 0 8px 8px;font-size:13px;color:#F1F5F9;vertical-align:top;width:50%;">🗺️ Money Map & Stream Planner</td>
      </tr>
      <tr>
        <td style="padding:8px 8px 8px 0;font-size:13px;color:#F1F5F9;vertical-align:top;width:50%;">⏱️ Full permanent tip history</td>
        <td style="padding:8px 0 8px 8px;font-size:13px;color:#F1F5F9;vertical-align:top;width:50%;">🐋 Whale alerts & tip predictions</td>
      </tr>
      <tr>
        <td style="padding:8px 8px 8px 0;font-size:13px;color:#F1F5F9;vertical-align:top;width:50%;">🔬 Advanced Live Mode coaching</td>
        <td style="padding:8px 0 8px 8px;font-size:13px;color:#F1F5F9;vertical-align:top;width:50%;">📊 Full best-time analysis</td>
      </tr>
    </table>
  </div>

  <div style="text-align:center;margin-bottom:24px;">
    <a href="${claimUrl}" style="display:inline-block;padding:18px 52px;border-radius:14px;background:linear-gradient(90deg,#16F4FF 0%,#7C5CFF 48%,#FF2BAE 100%);color:#fff;font-size:16px;font-weight:800;text-decoration:none;">
      Claim Your 14 Days Free 👑
    </a>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
    <tr>
      <td style="padding:0 8px 0 0;text-align:center;width:33.3%;vertical-align:top;">
        <div style="font-size:20px;margin-bottom:6px;">🛡️</div>
        <div style="font-size:12px;font-weight:700;color:#F1F5F9;">No credit card needed.</div>
        <div style="font-size:11px;color:#8D93AA;margin-top:2px;">No catch. Just our way of saying thank you.</div>
      </td>
      <td style="padding:0 8px;text-align:center;width:33.3%;vertical-align:top;">
        <div style="font-size:20px;margin-bottom:6px;">⏰</div>
        <div style="font-size:12px;font-weight:700;color:#F1F5F9;">14 days, starting when you claim it.</div>
        <div style="font-size:11px;color:#8D93AA;margin-top:2px;">Drops back to Free automatically after — no auto-billing.</div>
      </td>
      <td style="padding:0 0 0 8px;text-align:center;width:33.3%;vertical-align:top;">
        <div style="font-size:20px;margin-bottom:6px;">💗</div>
        <div style="font-size:12px;font-weight:700;color:#F1F5F9;">We appreciate you.</div>
        <div style="font-size:11px;color:#8D93AA;margin-top:2px;">Thanks for being one of our first users.</div>
      </td>
    </tr>
  </table>

  <p style="font-size:14px;color:#D7D9EA;margin:0 0 24px;">
    Keep slaying,<br/>
    <strong style="color:#F1F5F9;">The CamCashGrl Team</strong> 💋
  </p>

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
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function adminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Shared-secret check (see migration 20261111_lock_email_functions.sql).
let cachedSecret: string | null = null
async function isAuthorized(req: Request, admin: ReturnType<typeof adminClient>): Promise<boolean> {
  const provided = req.headers.get('x-camcash-secret') || ''
  if (!admin || !provided) return false
  if (!cachedSecret) {
    const { data, error } = await admin.rpc('get_email_function_secret')
    if (error || !data) return false
    cachedSecret = String(data)
  }
  if (provided.length !== cachedSecret.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ cachedSecret.charCodeAt(i)
  return diff === 0
}

serve(async (req) => {
  if (!(await isAuthorized(req, adminClient()))) return json({ error: 'unauthorized' }, 401)
  try {
    const body = await req.json()
    const email = body.email || body.record?.email

    if (!email) {
      return json({ error: 'No email provided' }, 400)
    }

    if (!isValidEmail(email)) {
      return json({ skipped: true, reason: 'invalid email' })
    }

    const claimUrl = `https://www.camcashgrl.com/dashboard?promo=${encodeURIComponent(CODE)}`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CamCashGrl <hello@camcashgrl.com>',
        to: email,
        subject: '🎁 A thank-you gift: 2 weeks of Creator Pro, on us',
        html: html(claimUrl),
      })
    })

    const data = await res.json()
    return json({ success: true, data })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
