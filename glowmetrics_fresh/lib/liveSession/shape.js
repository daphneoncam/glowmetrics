// Single shared computation of effective paused time and active duration
// for a live_sessions row, used by every route that returns session data —
// never reimplemented per-route.
//
// effective_paused_seconds = total_paused_seconds (finalized checkpoint)
//   + the currently-open pause's elapsed time, if any.
// active_duration_seconds  = (ended_at or now) - started_at - effective_paused_seconds
export function shapeLiveSession(row) {
  if (!row) return null

  const now = Date.now()
  const startedAtMs = new Date(row.started_at).getTime()
  const endedAtMs = row.ended_at ? new Date(row.ended_at).getTime() : null
  const pausedAtMs = row.paused_at ? new Date(row.paused_at).getTime() : null

  const openPauseSeconds = pausedAtMs ? Math.max(0, (now - pausedAtMs) / 1000) : 0
  const effectivePausedSeconds = (row.total_paused_seconds || 0) + openPauseSeconds

  const referenceEndMs = endedAtMs ?? now
  const activeDurationSeconds = Math.max(
    0,
    (referenceEndMs - startedAtMs) / 1000 - effectivePausedSeconds
  )

  return {
    ...row,
    effective_paused_seconds: Math.round(effectivePausedSeconds),
    active_duration_seconds: Math.round(activeDurationSeconds),
    free_active_seconds: freeClockActiveSeconds(row, now),
  }
}

// Free Live Mode clock: counts only from the first REAL tip of the stream
// (test tips are never saved). The database decides the clock start and the
// paused time after it (get_live_free_clock / _live_free_clock in
// 20261110_free_live_clock_from_first_real_tip.sql); this only ticks it
// between polls with the same formula:
//   free active = (paused_at ?? now) - clock_started_at - paused_seconds
// row.free_clock: undefined = not known (not fetched / lookup failed),
// { started_at: null } = no real tip yet, so the clock has not started.
// Returns undefined, null, or seconds — never a guessed number.
export function freeClockActiveSeconds(row, now = Date.now()) {
  const clock = row?.free_clock
  if (!clock) return undefined
  if (!clock.started_at) return null
  const ref = row.paused_at ? new Date(row.paused_at).getTime() : now
  const seconds = (ref - new Date(clock.started_at).getTime()) / 1000 - (Number(clock.paused_seconds) || 0)
  return Math.round(Math.max(0, seconds))
}

// Known entitlement / Private Mode refusals raised by the Live RPCs. Each is
// answered with fixed copy and a stable code, never the raw DB message.
const KNOWN_LIVE_ERRORS = [
  ['FREE_LIVE_WEEKLY_LIMIT', 403, 'You’ve used both Free Live Mode streams this week. They reset Monday at 12:00 AM your time. Upgrade to Pro for unlimited Live Mode.'],
  ['LIVE_MODE_REQUIRES_PRO', 403, 'Live Mode needs an active plan. Upgrade to Pro to start a live session.'],
  ['PLATFORM_LIMIT_REACHED', 403, 'Free tracks up to 3 platforms. Upgrade to Pro to go live on another platform.'],
  ['NO_LIVE_SESSION', 409, 'Go live before starting a private show.'],
  ['USERNAME_REQUIRED', 400, 'Enter the fan’s username to start a private show.'],
  ['INVALID_RATE', 400, 'Enter a private rate between $0 and $1,000 per minute.'],
  ['PLATFORM_UNKNOWN', 409, 'We can’t tell which platform this stream is on, so the private show wasn’t saved. End this stream and go live again with the platform selected.'],
  ['PLATFORM_MISMATCH', 409, 'This stream’s platform doesn’t match the platform detected on your broadcast page, so the private show wasn’t saved. End this stream and go live again with the correct platform.'],
]

// Sanitized error shaping — never returns a raw DB error string to the client.
export function sanitizedErrorResponse(error) {
  console.error('[live-session]', error)
  const message = typeof error?.message === 'string' ? error.message : ''
  for (const [code, status, text] of KNOWN_LIVE_ERRORS) {
    if (message.startsWith(code)) return { status, body: { error: text, code } }
  }
  if (error?.code === '22023') {
    return { status: 400, body: { error: 'Unrecognized value.' } }
  }
  if (error?.code === '28000') {
    return { status: 401, body: { error: 'Unauthorized' } }
  }
  return { status: 500, body: { error: 'Something went wrong. Please try again.' } }
}
