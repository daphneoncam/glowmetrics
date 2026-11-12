'use client'

// Free Live Mode allowance: 2 new streams per week, 35 ACTIVE minutes each,
// counted from the stream's first REAL tip (test tips are never saved).
// Display only. The server ends the stream at 35 free minutes and refuses a
// third start; this bar just mirrors the database's Free clock
// (engine.duration.free_active_seconds — see freeClockActiveSeconds in
// lib/liveSession/shape.js; paused time excluded) and the allowance from
// /api/live/usage.

export const FREE_WARN_SECONDS = 25 * 60
export const FREE_STRONG_WARN_SECONDS = 30 * 60

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function resetLabel(resetsAt, timeZone) {
  if (!resetsAt) return 'Monday'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', hour: 'numeric', minute: '2-digit' })
      .format(new Date(resetsAt))
  } catch (_) {
    return 'Monday 12:00 AM'
  }
}

export function freeAllowanceLevel(activeSeconds) {
  if (activeSeconds >= FREE_STRONG_WARN_SECONDS) return 'strong'
  if (activeSeconds >= FREE_WARN_SECONDS) return 'warn'
  return 'ok'
}

export default function LiveModeAllowanceBar({ engine }) {
  const allowance = engine.allowance
  const limitEnded = engine.limitEnded
  const box = (border, bg) => ({
    borderRadius: 12, padding: '12px 16px', marginBottom: 12,
    background: bg, border: `1px solid ${border}`, fontSize: 13, color: '#E2E8F0',
  })

  if (limitEnded) {
    return (
      <div data-testid="live-limit-ended" style={box('rgba(248,113,113,0.5)', 'rgba(248,113,113,0.10)')}>
        <strong style={{ color: '#F87171' }}>Your Free stream ended at 35 active minutes.</strong>{' '}
        Your earnings up to that point are saved. Upgrade to Pro for unlimited Live Mode.
        <button onClick={engine.dismissLimitEnded} style={{ marginLeft: 10, background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
      </div>
    )
  }

  if (!allowance || allowance.unlimited) return null

  const limit = allowance.active_seconds_per_stream
  const used = allowance.streams_used
  const perWeek = allowance.streams_per_week
  const reset = resetLabel(allowance.resets_at, allowance.timezone)
  const session = engine.duration
  const running = !!session && (engine.phase === 'active' || engine.phase === 'starting' || engine.phase === 'inactive_warning')

  if (!running) {
    const left = Math.max(0, perWeek - used)
    return (
      <div data-testid="live-allowance-idle" style={box('rgba(168,85,247,0.35)', 'rgba(168,85,247,0.08)')}>
        <strong>Free Live Mode:</strong> {Math.min(used, perWeek)} of {perWeek} streams used this week
        {left === 0 ? ` — resets ${reset}.` : ` · ${limit / 60} active minutes per stream.`}
      </div>
    )
  }

  const paused = session.live_substate === 'paused'
  const free = session.free_active_seconds
  const weekLabel = `Stream ${Math.min(used, perWeek)} of ${perWeek} this week`

  // Clock not started (no real tip yet) or not known yet (between polls /
  // lookup failed): say so, never show a guessed countdown.
  if (free === null || free === undefined) {
    return (
      <div data-testid="live-allowance-waiting" data-clock={free === null ? 'not_started' : 'unknown'} style={box('rgba(16,185,129,0.4)', 'rgba(16,185,129,0.08)')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#10B981', fontWeight: 700 }}>
            {free === null
              ? `Your ${limit / 60} free minutes start at your first real tip.`
              : `Free Live Mode: ${limit / 60} active minutes, counted from your first real tip.`}
          </span>
          <span style={{ color: '#94A3B8', fontSize: 12 }}>{weekLabel}</span>
        </div>
      </div>
    )
  }

  const active = free
  const pct = Math.min(100, (active / limit) * 100)
  const level = freeAllowanceLevel(active)
  const color = level === 'strong' ? '#F87171' : level === 'warn' ? '#FBBF24' : '#10B981'
  const message = level === 'strong'
    ? `${fmt(limit - active)} left. Your Free stream ends automatically at 35 active minutes — upgrade to Pro to keep streaming.`
    : level === 'warn'
    ? `${fmt(limit - active)} of Free Live Mode left in this stream.`
    : `${fmt(active)} of ${limit / 60}:00 active minutes used.`

  return (
    <div data-testid="live-allowance-active" data-level={level} style={box(`${color}66`, `${color}14`)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ color, fontWeight: 700 }}>{message}</span>
        <span style={{ color: '#94A3B8', fontSize: 12 }}>
          {paused ? 'Paused — time isn’t counting' : weekLabel}
        </span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.round(active)}
        aria-label="Free Live Mode active minutes used"
        style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 1s linear' }} />
      </div>
    </div>
  )
}
