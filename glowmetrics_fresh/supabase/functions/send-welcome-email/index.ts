import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

// Source of the deployed `send-welcome-email` Edge Function, now kept in the
// repo. Called by the signup trigger public.send_welcome_email_on_signup().
// Email content is unchanged.
//
// 2026-11-11: calls must carry the shared secret (x-camcash-secret header);
// anything else is refused. Previously anyone with the URL could send it.
// The trigger now sends only the email address (it used to send the whole
// auth.users row, including the password hash).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Skip obviously fake/disposable domains
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
  // Must have a real TLD (at least 2 chars)
  const tld = domain.split('.').pop()
  if (!tld || tld.length < 2) return false
  return true
}

const WELCOME_EMAIL_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#05070f;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">

  <div style="text-align:center;margin-bottom:32px;">
    <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#22D3EE,#EC4899);display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#fff;margin-bottom:20px;">$</div>
    <h1 style="color:#F1F5F9;font-size:26px;font-weight:900;margin:0 0 8px;">Welcome to CamCash &#x1F4B0;</h1>
    <p style="color:#94A3B8;font-size:15px;margin:0;line-height:1.6;">Your AI-powered earnings dashboard is ready.<br>Get started in 2 minutes with one of these options.</p>
  </div>

  <div style="background:#0f1420;border:1px solid rgba(34,211,238,0.25);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#22D3EE,#7C5CFF);display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">&#x1F4C1;</div>
      <div>
        <p style="margin:0;font-size:16px;font-weight:800;color:#F1F5F9;">Option 1 &#x2014; Upload your CSV</p>
        <p style="margin:0;font-size:12px;color:#475569;">Best for seeing your full earnings history</p>
      </div>
    </div>
    <a href="https://youtu.be/IJyzM7Pntyc" target="_blank" style="display:block;text-decoration:none;margin-bottom:16px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
      <div style="background:#0a0d18;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <p style="margin:0;font-size:12px;font-weight:700;color:#F1F5F9;">&#x25B6; Watch: How to export and upload your CSV (2 min)</p>
      </div>
      <img src="https://img.youtube.com/vi/IJyzM7Pntyc/maxresdefault.jpg" alt="How to upload CSV" style="width:100%;display:block;" />
    </a>
    <div style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(34,211,238,0.15);border:1px solid rgba(34,211,238,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#22D3EE;">1</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Go to Chaturbate &#x2192; Stats &amp; Data &#x2192; Token Stats &#x2192; Download CSV</p>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(34,211,238,0.15);border:1px solid rgba(34,211,238,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#22D3EE;">2</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Upload the file to your CamCash dashboard</p>
      </div>
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(34,211,238,0.15);border:1px solid rgba(34,211,238,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#22D3EE;">3</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">See your full earnings breakdown instantly</p>
      </div>
    </div>
    <div style="text-align:center;">
      <a href="https://www.camcashgrl.com/onboarding" style="display:inline-block;padding:14px 40px;border-radius:12px;background:linear-gradient(135deg,#22D3EE,#EC4899);color:#fff;font-size:15px;font-weight:800;text-decoration:none;">Upload My CSV Now &#x2192;</a>
    </div>
  </div>

  <div style="background:#0f1420;border:1px solid rgba(168,85,247,0.25);border-radius:16px;padding:24px;margin-bottom:28px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#a855f7,#EC4899);display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">&#x1F4E1;</div>
      <div>
        <p style="margin:0;font-size:16px;font-weight:800;color:#F1F5F9;">Option 2 &#x2014; Live Mode Extension</p>
        <p style="margin:0;font-size:12px;color:#475569;">Auto-tracks tips while you stream &#x2014; no CSV needed</p>
      </div>
    </div>
    <p style="font-size:13px;color:#94A3B8;margin:0 0 16px;line-height:1.6;">Install the CamCash Chrome extension once and every tip gets tracked automatically while you stream on Chaturbate.</p>
    <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.2);border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#a855f7;text-transform:uppercase;letter-spacing:1px;">How to install</p>
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#a855f7;">1</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Click the button below to download the ZIP file</p>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#a855f7;">2</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Unzip the folder on your computer</p>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#a855f7;">3</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Open Chrome &#x2192; go to <strong style="color:#F1F5F9;">chrome://extensions</strong></p>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#a855f7;">4</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Turn on <strong style="color:#F1F5F9;">Developer Mode</strong> (toggle top right)</p>
      </div>
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#a855f7;">5</div>
        <p style="margin:0;font-size:13px;color:#94A3B8;">Click <strong style="color:#F1F5F9;">Load unpacked</strong> &#x2192; select the unzipped CamCash folder</p>
      </div>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <a href="https://www.camcashgrl.com/camcash-extension.zip" style="display:inline-block;padding:14px 40px;border-radius:12px;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.5);color:#a855f7;font-size:15px;font-weight:800;text-decoration:none;">&#x1F4E5; Download Extension ZIP</a>
    </div>
    <div style="text-align:center;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
      <p style="margin:0 0 12px;font-size:12px;color:#475569;">Or scan this QR code on your phone</p>
      <img src="https://www.camcashgrl.com/qr-extension.png" alt="QR code" style="width:120px;height:120px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);" />
    </div>
  </div>

  <div style="text-align:center;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);">
    <p style="margin:0 0 6px;font-size:12px;color:#475569;">CamCash &middot; camcashgrl.com</p>
    <p style="margin:0;font-size:12px;color:#475569;">You received this because you signed up at camcashgrl.com</p>
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

    // Skip invalid or fake emails
    if (!isValidEmail(email)) {
      console.log(`[CamCash] Skipping invalid email`)
      return json({ skipped: true, reason: 'invalid email' })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CamCash <welcome@camcashgrl.com>',
        to: email,
        subject: 'Welcome to CamCash 💰 — here\'s how to get started',
        html: WELCOME_EMAIL_HTML
      })
    })

    const data = await res.json()

    return json({ success: true, data })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
