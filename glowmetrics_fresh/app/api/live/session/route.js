export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getLiveSessionCaller } from '../../../../lib/liveSession/auth'
import { shapeLiveSession, sanitizedErrorResponse } from '../../../../lib/liveSession/shape'
import { enforceActiveLimit, recentLimitEndedSession } from '../../../../lib/liveSession/activeLimit'
import { corsHeaders } from '../../../../lib/liveSession/cors'

const UNRESOLVED_STATUSES = ['starting', 'live', 'inactive_warning', 'ending']

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

// Restore. Never creates a session. The one exception to "never mutates
// anything": it runs the stale-session sweep first (missed-heartbeat ->
// needs_resolution -> auto-ended, see sweep_stale_live_session()), since this
// is the most frequently polled path and the simplest place to guarantee
// staleness is caught promptly regardless of which surface is active.
// Does not use the "last 12 hours of live_tips" heuristic this replaces.
export async function GET(req) {
  const cors = corsHeaders(req)
  const { supabase, user } = await getLiveSessionCaller(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store', ...cors } })
  }

  await supabase.rpc('sweep_stale_live_session')
  await enforceActiveLimit(supabase)

  // Always looked up, independent of the flag — an existing session must be
  // found and returned even when the flag is currently disabled or Edge
  // Config is unavailable.
  const { data, error } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('user_id', user.id)
    .in('status', UNRESOLVED_STATUSES)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    const { status, body } = sanitizedErrorResponse(error)
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...cors } })
  }

  let privateInterval = null
  let session = data
  if (data?.id) {
    // Free clock (starts at the first real tip). On any failure the field is
    // left off, so the page shows no countdown rather than a wrong one; the
    // limit itself is enforced in the database either way.
    const { data: clock, error: clockError } = await supabase.rpc('get_live_free_clock')
    if (clockError) {
      console.error('[live-session] get_live_free_clock', clockError)
    } else if (clock?.session_id === data.id) {
      session = { ...data, free_clock: { started_at: clock.clock_started_at ?? null, paused_seconds: Number(clock.paused_seconds) || 0 } }
    }

    const { data: open } = await supabase
      .from('live_private_intervals')
      .select('id,live_session_id,platform,username,started_at,rate_per_minute')
      .eq('live_session_id', data.id)
      .is('ended_at', null)
      .maybeSingle()
    privateInterval = open || null
  }

  return NextResponse.json(
    {
      session: shapeLiveSession(session),
      privateInterval,
      limitEnded: data ? null : await recentLimitEndedSession(supabase, user.id),
    },
    { headers: { 'Cache-Control': 'no-store', ...cors } }
  )
}
