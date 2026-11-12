import { summarizeOnboarding } from '../../../lib/onboardingSummary'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { parseCSV, detectPlatform, detectDateOrder, computeSnapshotStats } from '../../../lib/analytics'
import { platformLimitMessage } from '../../../lib/planLimits'
import { canonicalPlatform, PLATFORM_TOKEN_RATES } from '../../../lib/constants'
import { importTimeZone, toStoredInstant } from '../../../lib/creatorTimezone'
import { validateImportRows, describeProblems } from '../../../lib/importValidation'

const KNOWN_PLATFORMS = Object.keys(PLATFORM_TOKEN_RATES)
import { analyzeFormat } from '../../../lib/parseTracking'

const BATCH_SIZE = 250 // Safe batch size — never hit Supabase limits

// Rows are inserted in sequential BATCH_SIZE chunks, one Supabase round-trip
// each, so a large export takes far longer than Vercel's 10s default. When the
// function was killed mid-run the client received a truncated body and
// res.json() threw "Unexpected end of JSON input" — which looked like a parse
// error but was really a timeout. 60s is the Hobby-plan ceiling.
export const maxDuration = 60

// Any throw below would otherwise produce a response the client cannot parse,
// surfacing as the same misleading JSON error. Every failure path must return
// real JSON so the UI can show the actual reason.
export async function POST(req) {
  try {
    return await handleUpload(req)
  } catch (err) {
    console.error('[UPLOAD] Unhandled error:', err)
    return NextResponse.json(
      { error: err?.message || 'Upload failed unexpectedly. Please try again.' },
      { status: 500 }
    )
  }
}

async function handleUpload(req) {
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

  // `replace=true` used to delete EVERY tip the creator had (all platforms)
  // before anything was inserted, so a failed import lost their history. No
  // CamCash client sends it. It is rejected here, before any read of the file
  // or any write (parse log, delete, insert), so it can never change data.
  if (fd.get('replace') !== null && fd.get('replace') !== undefined && fd.get('replace') !== 'false') {
    return NextResponse.json(
      { error: 'Replacing all of your earnings during an import is not supported. Upload the file normally — tips you already have are skipped as duplicates.', code: 'replace_not_supported' },
      { status: 400 }
    )
  }

  // Export times carry no timezone; they are the creator's wall clock. Read
  // them in the creator's saved zone (or the zone the client resolved when
  // none is saved) and store real instants — never guess UTC/server time.
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

  // ── VALIDATE FORMAT ────────────────────────────────────────────────────
  const raw = await file.text()

  // Note: Tab-delimited (TSV) files are now supported via delimiter detection in parseCSV().
  // The parser will automatically detect and handle both comma and tab delimiters.
  // This enables support for platforms like BongaCams that export both formats.

  // ── PARSE + NORMALIZE ──────────────────────────────────────────────────
  // Prefer the platform the user explicitly selected in the UI — text-based
  // detection is a fallback for callers that don't pass one, and can't find
  // any platform keywords in a clean, already-normalized CSV (e.g. the
  // onboarding paste flow, which sends parsed rows rather than raw text).
  // A platform that can't be determined is never stored: rows saved as
  // 'Unknown' land in their own "Unknown" platform everywhere (Command Center,
  // breakdowns) and get DEFAULT_TOKEN_RATE instead of the platform's rate.
  // Order: the user's choice, then the file contents, then the file name
  // (e.g. "MFC2024-2026.csv" with no platform words inside), else ask.
  const explicitPlatform = canonicalPlatform((fd.get('platform') || '').toString().trim()) || ''
  if (explicitPlatform && !KNOWN_PLATFORMS.includes(explicitPlatform)) {
    return NextResponse.json({ error: `Unsupported platform: ${explicitPlatform}`, code: 'platform_required' }, { status: 400 })
  }
  const contentPlatform = detectPlatform(raw)
  let textDetectedPlatform = explicitPlatform || contentPlatform
  if (textDetectedPlatform === 'Unknown') textDetectedPlatform = detectPlatform((file.name || '').toString())
  if (!KNOWN_PLATFORMS.includes(textDetectedPlatform)) {
    return NextResponse.json({
      error: "We couldn't tell which platform this file is from. Choose the platform in the Platform menu and upload again.",
      code: 'platform_required',
    }, { status: 400 })
  }
  // Numeric dates (06/11/2024) are read in the order the file proves; when
  // every date could be either, the user chooses. Never guessed: a wrong
  // guess moves tips to other dates and past the duplicate check.
  const fileDateOrder = detectDateOrder(raw)
  const chosenDateOrder = ['MDY', 'DMY'].includes(fd.get('date_order')) ? fd.get('date_order') : null
  if (fileDateOrder === 'conflict') {
    return NextResponse.json({
      error: 'This file mixes month-first and day-first dates, so its dates cannot be read reliably. Export it again in a single date format.',
      code: 'date_order_conflict',
    }, { status: 400 })
  }
  if (fileDateOrder === 'ambiguous' && !chosenDateOrder) {
    return NextResponse.json({
      error: 'Every date in this file could be month-first or day-first (e.g. 06/11/2024). Choose the date format and upload again.',
      code: 'date_order_required',
    }, { status: 400 })
  }
  if (chosenDateOrder && (fileDateOrder === 'MDY' || fileDateOrder === 'DMY') && chosenDateOrder !== fileDateOrder) {
    return NextResponse.json({
      error: `The dates in this file are ${fileDateOrder === 'DMY' ? 'day-first (DD/MM/YYYY)' : 'month-first (MM/DD/YYYY)'}, which does not match the format you chose.`,
      code: 'date_order_mismatch',
    }, { status: 400 })
  }
  const dateOrder = fileDateOrder === 'ambiguous' ? chosenDateOrder : (fileDateOrder || null)

  // The parser keeps its content-detected platform when it has one (same
  // parse as before); otherwise it uses the resolved platform so token→USD
  // uses that platform's rate rather than the default.
  // strictDates: a row with no date is flagged (date_missing) and rejected by
  // the validation below — it is never stamped with the current time (#733).
  const parsed = parseCSV(raw, contentPlatform !== 'Unknown' ? contentPlatform : textDetectedPlatform, { dateOrder, strictDates: true })

  // Log parse attempt to track platform support and format issues
  const formatAnalysis = analyzeFormat(raw)
  // supabase.rpc() returns a PostgrestFilterBuilder — a thenable, not a real
  // Promise (it only implements .then(), not .catch()). Chaining .catch()
  // on it throws synchronously and was taking down the entire upload
  // request before any tips were inserted. try/catch keeps this logging
  // call non-blocking as intended.
  try {
    await supabase.rpc('log_paste_parse_attempt', {
      p_user_id: user.id,
      p_source: 'dashboard',
      p_attempted_platform: textDetectedPlatform,
      p_claimed_platform: explicitPlatform || null,
      p_supported: ['Chaturbate', 'BongaCams', 'MyFreeCams'].includes(textDetectedPlatform),
      p_raw_text: raw.substring(0, 500),
      p_line_count: formatAnalysis.line_count || null,
      p_has_tabs: formatAnalysis.has_tabs || null,
      p_has_commas: formatAnalysis.has_commas || null,
      p_top_shapes: formatAnalysis.top_shapes || null,
      p_parse_success: parsed.length > 0,
      p_error_reason: parsed.length > 0 ? null : 'CSV parsing returned no rows',
      p_error_details: formatAnalysis,
    })
  } catch (err) {
    console.error('Failed to log parse attempt:', err)
  }

  const rows = parsed.map((row) => {
    const tokens = Number(row.tokens) || 0
    const usd = parseFloat((Number(row.usd) || 0).toFixed(2))

    return {
      user_id:   user.id,
      date_time: toStoredInstant(row.dateRaw || row.date_time, timeZone),
      platform:  row.platform && row.platform !== 'Unknown' ? row.platform : textDetectedPlatform,
      username:  row.username  || 'Unknown',
      tip_type:  row.tip_type  || 'Tip',
      tip_note:  row.tip_note  || row.note || row.message || '',
      tokens,
      usd,
      // BongaCams paid-chat/spy-mode rows are flagged by parseCSV() (see
      // lib/analytics.js's BC_PAID_CHAT_TYPES) so they can be routed to
      // paid_sessions below instead of tips.
      is_paid_session: row.is_paid_session === true,
      session_type:    row.session_type || null,
      // Kept only for validation (the RPCs ignore extra keys): the date text as
      // exported, so "7" or "Apr 1" can be told apart from a real date.
      source_date:  row.dateRaw || row.date_time || '',
      date_missing: row.date_missing === true,
    }
  // A row with an unreadable date is NOT dropped here: it is kept so the
  // validation below can reject the import and say which row is wrong, instead
  // of the row silently vanishing.
  }).filter(r =>
    r.username !== 'Unknown' &&
    (r.tokens > 0 || r.usd > 0)
  )

  if (!rows.length) {
    return NextResponse.json(
      { error: 'No valid rows found. Check CSV format.' },
      { status: 400 }
    )
  }

  // ── DETECT PLATFORM ─────────────────────────────────────────────────────
  const detectedPlatform = textDetectedPlatform
  rows.forEach(r => { if (!r.platform || r.platform === 'Unknown') r.platform = detectedPlatform })
  // Store canonical names ('BC' → 'BongaCams'): insert_tips_dedup picks the
  // BongaCams token rate only for the exact name 'BongaCams'. The dedup key
  // does not include platform, so re-uploads still dedup against old rows.
  rows.forEach(r => { r.platform = canonicalPlatform(r.platform) })
  // A per-row platform column with an unrecognised value falls back to the
  // file's platform instead of being stored as a new, unknown platform.
  rows.forEach(r => { if (!KNOWN_PLATFORMS.includes(r.platform)) r.platform = detectedPlatform })

  // ── VALIDATE BEFORE ANY WRITE (all-or-nothing) ──────────────────────────
  // Nothing below this point runs if a single row is wrong: no tips, no paid
  // sessions. A corrupt file used to be saved and still logged "complete"
  // (#733: a running token balance saved as USD, bare numbers read as dates in
  // 2000/2001/0001). The rejection is logged as 'rejected' so it leaves a trace.
  const validation = validateImportRows(rows)
  if (!validation.ok) {
    try {
      await supabase.from('csv_uploads').insert({
        user_id:        user.id,
        upload_ref:     randomUUID(),
        platform:       detectedPlatform,
        file_name:      file.name || 'upload.csv',
        total_rows:     rows.length,
        inserted_rows:  0,
        skipped_rows:   0,
        total_usd:      0,
        total_tokens:   0,
        status:         'rejected',
      })
    } catch (logErr) {
      console.error('[UPLOAD] Failed to log rejected upload:', logErr.message)
    }
    return NextResponse.json({
      error:        describeProblems(validation),
      code:         'import_validation_failed',
      problems:     validation.problems,
      problemCount: validation.problemCount,
      rowsChecked:  validation.rowsChecked,
      truncated:    validation.truncated,
    }, { status: 422 })
  }

  // ── SPLIT TIPS FROM PAID CHAT / SPY-MODE SESSIONS ───────────────────────
  // Paid-chat/spy-mode rows (flagged above) never go into tips — they go to
  // paid_sessions via insert_paid_sessions_dedup, same as the onboarding
  // paste flow's separate /api/upload-paid-sessions call. Keeping the split
  // here (rather than filtering in lib/analytics.js) lets parseCSV() keep
  // returning one flat array, which app/dashboard/page.js's own parseCSV
  // caller still relies on.
  const tipRows = rows.filter(r => !r.is_paid_session)
  const paidSessionRows = rows.filter(r => r.is_paid_session)

  // ── VALIDATE BONGACAMS PAID SESSIONS ─────────────────────────────────────
  // If BongaCams is detected but no paid sessions found, it likely means the
  // "Chat Type" column is missing or has unexpected values. Warn the user.
  if ((textDetectedPlatform === 'BongaCams' || detectedPlatform === 'BongaCams') &&
      rows.length > 0 && paidSessionRows.length === 0) {
    console.warn('[UPLOAD] BongaCams detected but no paid sessions found. CSV may be missing "Chat Type" column.')
  }

  // ── ASSIGN DEDUP SEQUENCE ACROSS THE WHOLE FILE ─────────────────────────
  // Two rows can legitimately share the same (user, username, tokens, usd,
  // date_time) — e.g. the same fan tipping the same amount at the same
  // recorded minute — and insert_tips_dedup relies on tip_seq to tell them
  // apart instead of dropping the second one as a duplicate. That sequence
  // has to be assigned here, over the full file, rather than inside the RPC:
  // the RPC is called once per BATCH_SIZE-row chunk below, so a duplicate-key
  // group split across a batch boundary would otherwise get renumbered from 1
  // in the second batch and collide with the first batch's already-inserted
  // rows, silently dropping real tips.
  // Only tipRows get a tip_seq — insert_paid_sessions_dedup has no client_seq
  // concept (it dedups per-row against paid_sessions_dedup_unique instead).
  const dedupSeq = new Map()
  tipRows.forEach(r => {
    const key = `${r.user_id}|${r.username.toLowerCase()}|${r.tokens}|${r.usd.toFixed(2)}|${r.date_time}`
    const next = (dedupSeq.get(key) || 0) + 1
    dedupSeq.set(key, next)
    r.tip_seq = next
  })

  // ── SUMMARY STATS ────────────────────────────────────────────────────────
  // Computed once, shared by the csv_uploads audit log and the JSON response
  // (the response uses these so the importer UI can show a real summary —
  // rows/earnings/platform/date range — instead of just a row count).
  // Tip-only, same as csv_uploads' columns (which log the tip import, not
  // paid sessions) and the response fields the importer UI already reads.
  const summaryDates = tipRows.map(r => new Date(r.date_time)).filter(d => !isNaN(d))
  const summaryDateFrom = summaryDates.length ? new Date(Math.min(...summaryDates)) : null
  const summaryDateTo   = summaryDates.length ? new Date(Math.max(...summaryDates)) : null
  const summaryTotalUsd = parseFloat(tipRows.reduce((sum, r) => sum + (r.usd || 0), 0).toFixed(2))
  const summaryTotalTokens = tipRows.reduce((sum, r) => sum + (r.tokens || 0), 0)
  // Free-tier 31-day analysis window — same computeSnapshotStats() the
  // onboarding paste flow uses, so a CSV file upload and a pasted-then-
  // uploaded import report identical, real (not estimated) full-range vs
  // recent-window numbers.
  const snapshot = computeSnapshotStats(
    tipRows.map(r => ({ date: r.date_time, tokens: r.tokens, usd: r.usd })),
    31
  )

  // ── LOG TO csv_uploads ─────────────────────────────────────────────────
  // Shared by the success path below and the platform-limit block path, so a
  // blocked attempt still leaves an audit row instead of vanishing entirely.
  // The csv_uploads row is created BEFORE the tips are saved and the tips are
  // tagged with its id (tips.upload_id), so every saved row can be traced back
  // to the import that created it (before, upload_id was always NULL). The row
  // starts as 'processing' and is finished with its real status afterwards.
  const uploadId = randomUUID()
  let uploadRecordCreated = false
  const uploadRecordFields = () => {
    // Build sorted array of unique "YYYY-MM" strings covered
    const monthsSet = new Set(
      summaryDates.map(d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    )
    return {
      user_id:        user.id,
      upload_ref:     randomUUID(),
      platform:       detectedPlatform,
      file_name:      file.name || 'upload.csv',
      date_from:      summaryDateFrom,
      date_to:        summaryDateTo,
      months_covered: [...monthsSet].sort(),
      total_rows:     tipRows.length,
      total_usd:      summaryTotalUsd,
      total_tokens:   summaryTotalTokens,
    }
  }
  const startUploadRecord = async () => {
    try {
      const { error } = await supabase.from('csv_uploads').insert({
        id: uploadId, ...uploadRecordFields(), inserted_rows: 0, skipped_rows: 0, status: 'processing',
      })
      if (error) console.error('[UPLOAD] Failed to create csv_upload record:', error.message)
      else uploadRecordCreated = true
    } catch (logErr) {
      console.error('[UPLOAD] Failed to create csv_upload record:', logErr.message)
    }
  }
  const logCsvUpload = async (status) => {
    try {
      // supabase-js reports failures in { error } rather than throwing, so
      // without this check a failed audit row vanished silently (#672).
      const { error: logError } = uploadRecordCreated
        ? await supabase.from('csv_uploads').update({ inserted_rows: inserted, skipped_rows: skipped, status }).eq('id', uploadId)
        : await supabase.from('csv_uploads').insert({ ...uploadRecordFields(), inserted_rows: inserted, skipped_rows: skipped, status })
      if (logError) {
        console.error('[UPLOAD] Failed to log csv_upload record:', logError.message)
      } else {
        console.log(`[UPLOAD] Logged csv_upload record (${status}) for ${detectedPlatform}`)
      }
    } catch (logErr) {
      // Non-fatal — don't fail the whole upload if logging fails
      console.error('[UPLOAD] Failed to log csv_upload record:', logErr.message)
    }
  }

  // ── BATCH INSERT via dedup RPC ─────────────────────────────────────────
  let inserted = 0
  let skipped  = 0
  const errors = []
  const totalBatches = Math.ceil(tipRows.length / BATCH_SIZE)
  await startUploadRecord()

  for (let i = 0; i < tipRows.length; i += BATCH_SIZE) {
    const batch    = tipRows.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    const { data, error } = await supabase.rpc('insert_tips_dedup', {
      tips: batch,
      p_upload_id: uploadRecordCreated ? uploadId : null,
    })

    // insert_tips_dedup catches its own exceptions and returns them inside the
    // jsonb payload (data.error) rather than as a PostgREST-level error, so a
    // failed batch can otherwise look like a clean { inserted: 0, skipped: 0 }.
    if (error || data?.error) {
      const message = error?.message || data?.error
      console.error(`[UPLOAD] Batch ${batchNum}/${totalBatches} error:`, message)

      if (message?.includes('PLATFORM_LIMIT_REACHED')) {
        // Log the attempt — including any rows earlier batches in this same
        // request already inserted — before returning. Without this, a
        // correctly-rejected upload leaves zero trace in csv_uploads,
        // indistinguishable from a request that never ran at all.
        await logCsvUpload('blocked')
        return NextResponse.json({
          error: platformLimitMessage(),
          code: 'platform_limit_reached',
          upgradeUrl: '/pricing',
        }, { status: 402 })
      }

      errors.push({ batch: batchNum, error: message })
      continue
    }

    inserted += data?.inserted || 0
    skipped  += data?.skipped  || 0

    console.log(`[UPLOAD] Batch ${batchNum}/${totalBatches} — inserted: ${data?.inserted}, skipped: ${data?.skipped}`)
  }

  // (The old post-insert `validate_imported_tips` call was removed: that
  // function and its log table do not exist in production, so it never ran.
  // Validation now happens BEFORE any write — see "VALIDATE BEFORE ANY WRITE".)

  // ── BATCH INSERT PAID CHAT / SPY-MODE SESSIONS ──────────────────────────
  // Same RPC the onboarding paste flow's /api/upload-paid-sessions uses, so
  // rows flagged by parseCSV() (BC_PAID_CHAT_TYPES, lib/analytics.js) land in
  // paid_sessions instead of tips regardless of which import path sent them.
  let paidInserted = 0
  let paidSkipped  = 0
  const paidErrors = []
  const paidTotalBatches = Math.ceil(paidSessionRows.length / BATCH_SIZE)

  for (let i = 0; i < paidSessionRows.length; i += BATCH_SIZE) {
    const batch = paidSessionRows.slice(i, i + BATCH_SIZE).map(r => ({
      user_id:      r.user_id,
      date_time:    r.date_time,
      platform:     r.platform,
      username:     r.username,
      session_type: r.session_type,
      tokens:       r.tokens,
      usd:          r.usd,
    }))
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    const { data, error } = await supabase.rpc('insert_paid_sessions_dedup', {
      sessions: batch
    })

    if (error) {
      console.error(`[UPLOAD] Paid-session batch ${batchNum}/${paidTotalBatches} error:`, error.message)

      if (error.message?.includes('PLATFORM_LIMIT_REACHED')) {
        // Tips (if any) already inserted above — this only blocks the
        // paid-session half, same as onboarding's two independent requests
        // would behave if the paid-sessions call failed on its own.
        await logCsvUpload('partial')
        return NextResponse.json({
          error: platformLimitMessage(),
          code: 'platform_limit_reached',
          upgradeUrl: '/pricing',
        }, { status: 402 })
      }

      paidErrors.push({ batch: batchNum, error: error.message })
      continue
    }

    paidInserted += data?.inserted || 0
    paidSkipped  += data?.skipped  || 0

    console.log(`[UPLOAD] Paid-session batch ${batchNum}/${paidTotalBatches} — inserted: ${data?.inserted}, skipped: ${data?.skipped}`)
  }

  // 'complete' only if EVERY tip batch and every private-earnings batch saved.
  await logCsvUpload(errors.length > 0 || paidErrors.length > 0 ? 'partial' : 'complete')

  // ── RESPONSE ───────────────────────────────────────────────────────────
  const response = {
    ok:        errors.length === 0 && paidErrors.length === 0,
    inserted,
    skipped,
    total:     tipRows.length,
    batches:   totalBatches,
    batchSize: BATCH_SIZE,
    platform:  detectedPlatform, // ← used by dashboard toast
    totalUsd:  summaryTotalUsd,
    dateFrom:  summaryDateFrom ? summaryDateFrom.toISOString() : null,
    dateTo:    summaryDateTo ? summaryDateTo.toISOString() : null,
    paidSessionsInserted: paidInserted,
    paidSessionsSkipped:  paidSkipped,
    snapshot,
    onboardingSummary: summarizeOnboarding(rows, timeZone),
    timeZone,
  }

  if (errors.length > 0) {
    response.warnings = errors
    response.message  = `${errors.length} batch(es) had errors but upload continued. ${inserted} of ${tipRows.length} rows inserted.`
    console.warn('[UPLOAD] Completed with errors:', errors)
  } else {
    response.message = `All ${inserted} tips inserted successfully (${skipped} duplicates skipped).`
    console.log('[UPLOAD] Complete:', response.message)
  }

  if (paidErrors.length > 0) {
    response.paidSessionsWarnings = paidErrors
    response.message = `Some private earnings could not be saved. ${paidInserted} private transactions inserted; retry the import to save remaining rows safely.`
    console.warn('[UPLOAD] Paid-session batches completed with errors:', paidErrors)
  }

  // ── BONGACAMS NO PAID SESSIONS WARNING ──────────────────────────────────
  // If BongaCams detected but no paid sessions found, user may be missing a
  // session-type column (Chat Type, Session Type, Activity Type, etc.)
  if ((detectedPlatform === 'BongaCams') && paidSessionRows.length === 0 && tipRows.length > 0) {
    response.bongaCamsWarning = 'No private/group/spy sessions detected. If your BongaCams export includes private chat sessions, verify it contains a session-type column (e.g., "Chat Type", "Session Type", "Activity Type").'
    console.warn('[UPLOAD] BongaCams detected but no paid sessions found. CSV may be missing a session-type column.')
  }

  // ── FOUNDER NOTIFICATION (non-blocking) ───────────────────────────────
  if (errors.length === 0) {
    try {
      const origin = new URL(req.url).origin
      fetch(`${origin}/api/notify/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          platform: detectedPlatform,
          tip_count: inserted,
          user_id: user.id,
        }),
      }).catch(err => console.error('[upload] notify failed:', err.message))
    } catch (_) {}
  }

  return NextResponse.json(response)
}
