import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cron endpoint — never statically optimize this (see the same note in
// app/api/cron/expire-goodwill-trials/route.js).
export const dynamic = 'force-dynamic'
// The steps run one after another; give the whole job room to finish.
export const maxDuration = 60

// Same steps, same order and same response keys as before. New (2026-11-11):
// each step's outcome is saved to public.cron_runs, because the admin emails
// stopped after Nov 7 and Vercel Hobby keeps runtime logs for only 1 hour,
// so there was no way to see which step failed.
const STEPS = [
  ['digest', '/api/notify/digest'],
  ['goodwillExpiry', '/api/cron/expire-goodwill-trials'],
  ['subscriptionDrift', '/api/cron/check-subscription-drift'],
  ['webhookFailures', '/api/cron/check-webhook-failures'],
  ['dailySummary', '/api/cron/notify-daily-summary'],
  ['trialAlerts', '/api/cron/notify-trial-alerts'],
  ['conversionReport', '/api/cron/notify-conversions'],
  ['emailFailures', '/api/cron/check-email-failures'],
  ['trialExpiry3Day', '/api/cron/send-trial-expiry-3day'],
  ['trialExpiry1Day', '/api/cron/send-trial-expiry-1day'],
  ['trialExpired', '/api/cron/send-trial-expired'],
  ['subscriptionTips', '/api/cron/send-subscription-tips'],
]

function admin() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function recordRun(db, runId, step, path, outcome) {
  if (!db) return
  try {
    const { error } = await db.from('cron_runs').insert({
      run_id: runId,
      job: 'daily',
      step,
      path,
      ok: outcome.ok,
      status_code: outcome.status,
      duration_ms: outcome.ms,
      result: outcome.body ?? null,
      error: outcome.error ?? null,
    })
    if (error) console.error('[cron/daily] cron_runs insert failed:', error.message)
  } catch (e) {
    console.error('[cron/daily] cron_runs insert threw:', e.message)
  }
}

export async function GET(req) {
  const origin = new URL(req.url).origin
  const db = admin()
  const runId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}`)
  const response = {}
  let allOk = true

  for (const [key, path] of STEPS) {
    const started = Date.now()
    let outcome
    try {
      const res = await fetch(`${origin}${path}`)
      const body = await res.json().catch(() => null)
      const ok = res.ok && body?.success !== false
      outcome = { ok, status: res.status, body, ms: Date.now() - started, error: ok ? null : (body?.error || `HTTP ${res.status}`) }
      response[key] = body
      response[`${key}Error`] = null
      // Previous behaviour kept: only a thrown fetch counts toward `success`.
    } catch (err) {
      console.error(`[cron/daily] ${key} failed:`, err.message)
      outcome = { ok: false, status: null, body: null, ms: Date.now() - started, error: err.message }
      response[key] = null
      response[`${key}Error`] = err.message
      allOk = false
    }
    await recordRun(db, runId, key, path, outcome)
  }

  return NextResponse.json({ success: allOk, runId, ...response })
}
