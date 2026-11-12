import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { validateImportRows, describeProblems } from '../../../../lib/importValidation'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export async function POST(request) {
  const auth = request.headers.get('Authorization')
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = auth.replace('Bearer ', '')
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })

  const { data: { user }, error: ue } = await supabase.auth.getUser(token)
  if (ue || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

  const userId = user.id

  // Read credentials from profiles (RLS: own row)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('chaturbate_username, chaturbate_stats_token')
    .eq('id', userId)
    .single()

  if (profileError || !profile?.chaturbate_stats_token) {
    return NextResponse.json({ error: 'No stats token configured' }, { status: 400 })
  }

  const { chaturbate_username, chaturbate_stats_token } = profile

  // Check sync cursor for incremental sync
  const { data: cursorRow } = await supabase
    .from('sync_cursors')
    .select('last_tip_id')
    .eq('user_id', userId)
    .eq('platform', 'chaturbate_stats')
    .single()

  const lastTipTimestamp = cursorRow?.last_tip_id || null

  const startedAt = new Date().toISOString()

  try {
    let allResults = []
    let offset = 0
    const LIMIT = 500
    const MAX_PAGES = 20

    while (offset / LIMIT < MAX_PAGES) {
      let url = `https://chaturbate.com/statsapi/tipping/token-stats/?username=${encodeURIComponent(chaturbate_username)}&token=${encodeURIComponent(chaturbate_stats_token)}&limit=${LIMIT}&offset=${offset}`
      if (lastTipTimestamp) url += `&date_gte=${encodeURIComponent(lastTipTimestamp)}`

      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'CamCash/1.0' } })
        if (!res.ok) break
        const data = await res.json()
        const results = data?.results || []
        if (results.length === 0) break
        allResults = [...allResults, ...results]
        if (results.length < LIMIT) break
        offset += LIMIT
      } catch {
        break
      }
    }

    if (allResults.length === 0) {
      return NextResponse.json({ message: 'No new tips found', inserted: 0, skipped: 0, total: 0 })
    }

    // Map to insert_tips_dedup schema
    const rows = allResults.map(r => ({
      user_id: userId,
      date_time: r.created_at,
      platform: 'Chaturbate',
      username: r.username,
      tip_type: 'Tip',
      tokens: parseInt(r.num_tokens || 0),
      usd: parseFloat(parseFloat(r.value_in_usd || 0).toFixed(2)),
      tip_note: r.tip_note || null,
    }))

    // All-or-nothing validation BEFORE any write (same rules as /api/upload):
    // nothing is saved and the sync cursor does not advance if a row is wrong.
    const validation = validateImportRows(rows)
    if (!validation.ok) {
      await supabase.from('sync_jobs').insert({
        user_id: userId,
        platform: 'Chaturbate',
        status: 'failed',
        mode: 'stats_api',
        records_inserted: 0,
        records_skipped: 0,
        error_message: `Validation failed: ${validation.problemCount} invalid row(s); nothing was saved`,
        started_at: startedAt,
        completed_at: new Date().toISOString()
      })
      return NextResponse.json({
        error: describeProblems(validation),
        code: 'import_validation_failed',
        problems: validation.problems,
        problemCount: validation.problemCount,
        rowsChecked: validation.rowsChecked,
        truncated: validation.truncated,
      }, { status: 422 })
    }

    // Use SECURITY DEFINER RPC — bypasses RLS, handles dedup
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('insert_tips_dedup', {
      tips: rows
    })

    if (rpcErr) throw new Error(rpcErr.message)

    const inserted = rpcResult?.inserted ?? 0
    const skipped = rpcResult?.skipped ?? 0

    // Update sync cursor with most recent tip timestamp
    const mostRecent = allResults
      .map(r => r.created_at)
      .filter(Boolean)
      .sort()
      .pop()

    if (mostRecent) {
      await supabase
        .from('sync_cursors')
        .upsert({
          user_id: userId,
          platform: 'chaturbate_stats',
          last_tip_id: mostRecent,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform' })
    }

    await supabase.from('sync_jobs').insert({
      user_id: userId,
      platform: 'Chaturbate',
      status: 'completed',
      mode: 'stats_api',
      records_inserted: inserted,
      records_skipped: skipped,
      error_message: null,
      started_at: startedAt,
      completed_at: new Date().toISOString()
    })

    return NextResponse.json({ inserted, skipped, total: rows.length })

  } catch (err) {
    console.error('[stats-sync]', err)
    await supabase.from('sync_jobs').insert({
      user_id: userId,
      platform: 'Chaturbate',
      status: 'failed',
      mode: 'stats_api',
      records_inserted: 0,
      records_skipped: 0,
      error_message: err.message,
      started_at: startedAt,
      completed_at: new Date().toISOString()
    })
    return NextResponse.json({ error: 'Sync failed', detail: err.message }, { status: 500 })
  }
}
