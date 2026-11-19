import { NextResponse } from 'next/server'
import { requireCronAuth } from '../../../../lib/cron-auth'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const FOUNDER_EMAIL = 'daphneoncam@gmail.com'

// Same build-time prerendering hazard as the cron routes that call this —
// it constructs a Supabase admin client with SUPABASE_SERVICE_ROLE_KEY,
// which isn't set in the build environment.
export const dynamic = 'force-dynamic'

export async function GET(req) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const todayLabel = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })

    // ── Signups in last 24h ──
    // .schema() is a method on the client itself (selects which Postgres
    // schema .from() resolves against) — it has to come before .from(), not
    // chained after the query builder. Chaining it last threw
    // "gte(...).schema is not a function" and crashed the whole digest.
    const { data: newUsers, error: newUsersErr } = await supabaseAdmin
      .schema('auth')
      .from('users')
      .select('email,created_at')
      .gte('created_at', since)
    const newSignups = newUsersErr ? [] : (newUsers || [])

    // ── Total signups all time ──
    const { count: totalUsers } = await supabaseAdmin
      .schema('auth')
      .from('users')
      .select('*', { count: 'exact', head: true })

    // ── Tips uploaded in last 24h ──
    const { data: recentUploads } = await supabaseAdmin
      .from('csv_uploads')
      .select('user_id,platform,inserted_rows,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
    const uploads = recentUploads || []

    // ── Feedback submitted in last 24h (table may not exist — safe fallback) ──
    let feedbackRows = []
    try {
      const { data: fb } = await supabaseAdmin
        .from('feedback')
        .select('*')
        .gte('created_at', since)
      feedbackRows = fb || []
    } catch (_) {}

    // ── Skip if zero activity ──
    const hasActivity = newSignups.length > 0 || uploads.length > 0 || feedbackRows.length > 0
    if (!hasActivity) {
      console.log('[digest] No activity — skipping email')
      return NextResponse.json({ success: true, skipped: true, reason: 'no activity' })
    }

    // ── Build HTML ──
    const signupRows = newSignups.map(u =>
      `<tr>
        <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;">${u.email}</td>
        <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#94a3b8;font-size:12px;">${new Date(u.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</td>
      </tr>`
    ).join('')

    const uploadRows = uploads.map(u =>
      `<tr>
        <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#22D3EE;font-size:13px;font-weight:600;">${u.platform}</td>
        <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#10B981;font-size:13px;">${u.inserted_rows?.toLocaleString()} tips</td>
      </tr>`
    ).join('')

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#05070f;font-family:'Inter',system-ui,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#0d1117;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:24px;margin-bottom:4px;">📊</div>
      <div style="font-size:20px;font-weight:800;color:#fff;">CamCash Daily</div>
      <div style="font-size:13px;color:#475569;margin-top:4px;">${todayLabel}</div>
    </div>

    <!-- Summary strip -->
    <div style="display:flex;padding:20px 32px;gap:0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="flex:1;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#7C5CFF;">${newSignups.length}</div>
        <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px;">New signups</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#22D3EE;">${uploads.length}</div>
        <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px;">CSV uploads</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#f1f5f9;">${(totalUsers || 0).toLocaleString()}</div>
        <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px;">Total users</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#EC4899;">${feedbackRows.length}</div>
        <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px;">Feedback</div>
      </div>
    </div>

    <div style="padding:28px 32px;">
      ${newSignups.length > 0 ? `
      <!-- New signups -->
      <div style="margin-bottom:28px;">
        <div style="font-size:12px;font-weight:700;color:#7C5CFF;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">New Signups (${newSignups.length})</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="padding:6px 0;text-align:left;font-size:11px;color:#334155;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">Email</th>
            <th style="padding:6px 0;text-align:left;font-size:11px;color:#334155;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">Time (ET)</th>
          </tr>
          ${signupRows}
        </table>
      </div>` : ''}

      ${uploads.length > 0 ? `
      <!-- Uploads -->
      <div style="margin-bottom:28px;">
        <div style="font-size:12px;font-weight:700;color:#22D3EE;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">CSV Uploads (${uploads.length})</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="padding:6px 0;text-align:left;font-size:11px;color:#334155;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">Platform</th>
            <th style="padding:6px 0;text-align:left;font-size:11px;color:#334155;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">Tips</th>
          </tr>
          ${uploadRows}
        </table>
      </div>` : ''}

      ${feedbackRows.length > 0 ? `
      <!-- Feedback -->
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#EC4899;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Feedback (${feedbackRows.length})</div>
        <div style="font-size:13px;color:#94a3b8;">${feedbackRows.length} new feedback submission${feedbackRows.length !== 1 ? 's' : ''} — check Supabase for details.</div>
      </div>` : ''}

      <div style="margin-top:8px;">
        <a href="https://supabase.com/dashboard/project/_/auth/users"
           style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#7C5CFF,#EC4899);border-radius:8px;color:#fff;font-size:13px;font-weight:700;text-decoration:none;margin-right:10px;">
          View Users →
        </a>
        <a href="https://supabase.com/dashboard/project/_/editor"
           style="display:inline-block;padding:10px 20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#94a3b8;font-size:13px;font-weight:600;text-decoration:none;">
          Supabase Editor →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:11px;color:#334155;">CamCash · Daily digest · Runs at 8 AM ET</div>
    </div>
  </div>
</body>
</html>`

    await resend.emails.send({
      from: 'CamCash Notifications <notifications@camcashgrl.com>',
      to: FOUNDER_EMAIL,
      subject: `📊 CamCash Daily — ${todayLabel}`,
      html,
    })

    return NextResponse.json({ success: true, newSignups: newSignups.length, uploads: uploads.length, feedback: feedbackRows.length })
  } catch (err) {
    console.error('[notify/digest] Failed:', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
