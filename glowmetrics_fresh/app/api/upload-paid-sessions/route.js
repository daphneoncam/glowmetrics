import { analyzeFormat } from '../../../lib/parseTracking'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
// Token rates — always imported from constants, never hardcoded
import { tokenRate, canonicalPlatform, PLATFORM_TOKEN_RATES } from '../../../lib/constants'
import { platformLimitMessage } from '../../../lib/planLimits'
import { importTimeZone, toStoredInstant } from '../../../lib/creatorTimezone'

const BATCH_SIZE = 250

export async function POST(req) {
  const auth = req.headers.get('Authorization')
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = auth.replace('Bearer ', '')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: ue } = await supabase.auth.getUser(token)
  if (ue || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const fd = await req.formData()
  const file = fd.get('file')

  // Same storage contract as /api/upload: naive export times are the
  // creator's wall clock, read in their saved zone and stored as instants.
  const { data: tzProfile } = await supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle()
  const timeZone = importTimeZone(tzProfile?.timezone, fd.get('time_zone'))
  if (!timeZone) {
    return NextResponse.json(
      { error: 'Choose your timezone before importing so your earnings land on the right days and hours.', code: 'timezone_required' },
      { status: 400 }
    )
  }
  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  // The caller names the platform; rows are never labelled with a platform
  // the file did not come from, and never stored as an unknown platform.
  const platform = canonicalPlatform((fd.get('platform') || '').toString().trim())
  if (!platform || !Object.keys(PLATFORM_TOKEN_RATES).includes(platform)) {
    return NextResponse.json({ error: 'A supported platform is required.', code: 'platform_required' }, { status: 400 })
  }

  // ── PARSE CSV ─────────────────────────────────────────────
  // Expected format from onboarding parser:
  // date_time,username,session_type,tokens,usd
  const raw = await file.text()
  const lines = raw.trim().split('\n').filter(Boolean)
  if (lines.length < 2) {
    return NextResponse.json({ error: 'No session rows found.' }, { status: 400 })
  }

  const VALID_SESSION_TYPES = [
    'Private Chat', 'Full-Private Chat', 'Group Chat', 'Spy Mode'
  ]

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    if (cols.length < 5) continue

    const [date_time, username, session_type, tokensRaw, usdRaw] = cols
    if (!date_time || !username || !session_type) continue
    if (!VALID_SESSION_TYPES.includes(session_type)) continue

    const storedAt = toStoredInstant(date_time, timeZone)
    if (!storedAt) continue

    const tokens = parseInt(tokensRaw) || 0
    const rawUsd = parseFloat(usdRaw) || 0
    // Always derive USD from tokens if not present, using constants.js rate
    const usd = rawUsd > 0
      ? parseFloat(rawUsd.toFixed(4))
      : parseFloat((tokens * tokenRate(platform)).toFixed(4))

    if (tokens < 1 && usd <= 0) continue

    rows.push({
      user_id:      user.id,
      date_time:    storedAt,
      platform,
      username:     username.toLowerCase().trim(),
      session_type,
      tokens,
      usd,
    })
  }

  // Save the full dataset of every private-sessions import (successful or
  // not) for parser diagnostics. Non-blocking: a logging failure never stops
  // the import. The DB function only logs for the caller's own account.
  try {
    const formatAnalysis = analyzeFormat(raw)
    await supabase.rpc('log_paste_parse_attempt', {
      p_user_id: user.id,
      p_source: 'onboarding',
      p_attempted_platform: platform || 'unknown',
      p_claimed_platform: platform || null,
      p_supported: true,
      p_raw_text: raw,
      p_line_count: formatAnalysis.line_count || null,
      p_has_tabs: formatAnalysis.has_tabs || null,
      p_has_commas: formatAnalysis.has_commas || null,
      p_top_shapes: formatAnalysis.top_shapes || null,
      p_parse_success: rows.length > 0,
      p_error_reason: rows.length > 0 ? null : 'No valid paid session rows found',
      p_error_details: { ...formatAnalysis, importer: 'paid_sessions', data_lines: lines.length - 1, parsed_rows: rows.length },
    })
  } catch (err) {
    console.error('[PAID-SESSIONS] Failed to log parse attempt:', err)
  }

  if (!rows.length) {
    return NextResponse.json(
      { error: 'No valid paid session rows found. Check format.' },
      { status: 400 }
    )
  }

  // ── BATCH INSERT via dedup RPC ─────────────────────────────
  let inserted = 0
  let skipped  = 0
  const errors = []
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE)

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch    = rows.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    const { data, error } = await supabase.rpc('insert_paid_sessions_dedup', {
      sessions: batch
    })

    if (error) {
      console.error(`[PAID-SESSIONS] Batch ${batchNum}/${totalBatches} error:`, error.message)

      if (error.message?.includes('PLATFORM_LIMIT_REACHED')) {
        return NextResponse.json({
          error: platformLimitMessage(),
          code: 'platform_limit_reached',
          upgradeUrl: '/pricing',
        }, { status: 402 })
      }

      errors.push({ batch: batchNum, error: error.message })
      continue
    }

    inserted += data?.inserted || 0
    skipped  += data?.skipped  || 0
    console.log(`[PAID-SESSIONS] Batch ${batchNum}/${totalBatches} — inserted: ${data?.inserted}, skipped: ${data?.skipped}`)
  }

  // ── RESPONSE ───────────────────────────────────────────────
  const response = {
    ok:       errors.length === 0,
    inserted,
    skipped,
    total:    rows.length,
    platform,
  }

  if (errors.length > 0) {
    response.warnings = errors
    response.message  = `${errors.length} batch(es) had errors. ${inserted} of ${rows.length} sessions inserted.`
  } else {
    response.message = `${inserted} paid sessions inserted (${skipped} duplicates skipped).`
  }

  console.log('[PAID-SESSIONS]', response.message)
  return NextResponse.json(response)
}
