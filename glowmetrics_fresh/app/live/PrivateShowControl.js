'use client'

import { useEffect, useRef, useState } from 'react'

// Start / end a private interval inside the running live session. The show
// keeps running; ending private never ends the stream. The platform is the
// running session's own (recorded server-side, never guessed here). The
// estimate is the same model the database uses when it closes the interval:
// rate_per_minute x elapsed minutes (_close_private_intervals).
export function privateElapsedSeconds(interval, now = Date.now()) {
  if (!interval?.started_at) return 0
  return Math.max(0, (now - new Date(interval.started_at).getTime()) / 1000)
}

export function privateEstimateUsd(interval, now = Date.now()) {
  // Number(null) is 0: a missing rate must give no estimate, not $0.
  if (interval?.rate_per_minute === null || interval?.rate_per_minute === undefined || interval?.rate_per_minute === '') return null
  const rate = Number(interval.rate_per_minute)
  if (!Number.isFinite(rate)) return null
  return Math.round(rate * (privateElapsedSeconds(interval, now) / 60) * 100) / 100
}

function fmt(sec) {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// Which explanation the button shows when a private show can't start yet.
// Mirrors start_private_interval: it needs a session whose status is 'live'.
export function privateStartBlocker(session) {
  if (!session || !['starting', 'live', 'inactive_warning'].includes(session.status)) return 'no_session'
  if (session.status === 'starting') return 'connecting'
  if (session.status === 'inactive_warning') return 'inactive'
  if (!session.stream_platform) return 'no_platform'
  return null
}

const BLOCKER_COPY = {
  no_session: { title: 'First begin a Live Mode session', body: 'Private shows are tracked inside a Live Mode stream. Press ▶ Start Stream first, then start your private show.' },
  connecting: { title: 'Your stream is still connecting', body: 'Private shows can start once the CamCash extension connects and your stream shows as live.' },
  inactive: { title: 'Confirm you’re still live', body: 'Answer the “Still live?” prompt first, then start your private show.' },
  no_platform: { title: 'Platform not set', body: 'We can’t tell which platform this stream is on, so a private show can’t be saved. End this stream and start again with the platform selected.' },
}

const C = {
  overlay: 'rgba(5,6,12,0.72)', card: '#13151f', border: 'rgba(148,163,184,0.18)',
  white: '#F8FAFC', muted: '#94A3B8', cyan: '#00e5cc', pink: '#EC4899', red: '#F87171',
}

export default function PrivateShowControl({ engine }) {
  // step: null (closed) | 'blocked' | 'confirm' | 'details'
  const [step, setStep] = useState(null)
  const [rate, setRate] = useState('')
  const [username, setUsername] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const firstFieldRef = useRef(null)
  const open = engine.privateInterval
  const session = engine.serverSession
  const platform = session?.stream_platform || null
  const blocker = privateStartBlocker(session)

  const close = () => { setStep(null); setSubmitted(false) }
  useEffect(() => {
    if (!step) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])
  useEffect(() => { if (step === 'details') firstFieldRef.current?.focus() }, [step])
  // The stream ended or dropped while the pop-up was open: show why.
  useEffect(() => { if (blocker && (step === 'confirm' || step === 'details')) setStep('blocked') }, [blocker, step])
  // Another tab / the extension started the private: nothing left to ask.
  useEffect(() => { if (open && step) close() }, [open, step])

  const btn = (color, disabled) => ({
    padding: '7px 14px', borderRadius: 8, background: `${color}22`, border: `1px solid ${color}66`,
    color, fontWeight: 700, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  })
  const input = {
    padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.border}`, width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', color: C.white, fontSize: 14,
  }

  if (open) {
    const estimate = privateEstimateUsd(open)
    const hasRate = open.rate_per_minute !== null && open.rate_per_minute !== undefined && open.rate_per_minute !== ''
    return (
      <span data-testid="private-open" style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#F9A8D4' }}>
          🔒 Private{open.username ? ` with ${open.username}` : ''} · {open.platform}
        </span>
        <span data-testid="private-elapsed" style={{ fontFamily: 'monospace', fontSize: 12, color: '#F1F5F9' }}>
          {fmt(privateElapsedSeconds(open))}
        </span>
        <span data-testid="private-estimate" style={{ fontSize: 12, color: '#10B981', fontWeight: 700 }}>
          {estimate === null ? '—' : `~$${estimate.toFixed(2)}`}{' '}
          <span style={{ color: C.muted, fontWeight: 400 }}>
            {hasRate ? `at $${Number(open.rate_per_minute).toFixed(2)}/min` : 'no rate entered'}
          </span>
        </span>
        <button data-testid="private-end" disabled={engine.actionPending} onClick={engine.endPrivate} style={btn(C.pink, engine.actionPending)}>
          End Private
        </button>
      </span>
    )
  }

  const rateNum = Number(rate)
  const name = username.trim()
  const rateValid = rate !== '' && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 1000
  const nameValid = name.length > 0 && name.length <= 80
  const canContinue = rateValid && nameValid && !engine.actionPending

  const start = async (ratePerMinute, fan) => {
    setSubmitted(true)
    if (await engine.startPrivate(ratePerMinute, fan)) {
      setUsername(''); setRate(''); close()
    }
  }

  const openPrompt = () => setStep(blocker ? 'blocked' : 'confirm')
  const copy = blocker ? BLOCKER_COPY[blocker] : null

  return (
    <>
      <button data-testid="private-start" type="button" disabled={engine.actionPending}
        aria-haspopup="dialog" onClick={openPrompt}
        title={blocker ? BLOCKER_COPY[blocker].title : `Private on ${platform}`}
        style={btn(C.pink, engine.actionPending)}>
        🔒 Start Private{platform && !blocker ? ` · ${platform}` : ''}
      </button>

      {step && (
        <div data-testid="private-overlay" onClick={close}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: C.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="private-dialog-title" data-testid={`private-dialog-${step}`}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 380, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, color: C.white, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

            {step === 'blocked' && copy && (
              <>
                <h2 id="private-dialog-title" style={{ margin: '0 0 8px', fontSize: 17 }}>{copy.title}</h2>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{copy.body}</p>
                <button data-testid="private-blocked-ok" type="button" onClick={close} style={{ ...btn(C.cyan, false), width: '100%', padding: '10px 14px', fontSize: 14 }}>OK</button>
              </>
            )}

            {step === 'confirm' && (
              <>
                <h2 id="private-dialog-title" style={{ margin: '0 0 8px', fontSize: 17 }}>Starting private show{platform ? ` on ${platform}` : ''}?</h2>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Your stream keeps running. Ending the private show never ends your stream.</p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button data-testid="private-confirm-no" type="button" onClick={close} style={{ ...btn(C.muted, false), flex: 1, padding: '10px 14px', fontSize: 14 }}>No</button>
                  <button data-testid="private-confirm-yes" type="button" onClick={() => setStep('details')} style={{ ...btn(C.cyan, false), flex: 1, padding: '10px 14px', fontSize: 14 }}>Yes</button>
                </div>
              </>
            )}

            {step === 'details' && (
              <>
                <h2 id="private-dialog-title" style={{ margin: '0 0 14px', fontSize: 17 }}>Private show details</h2>

                <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>Platform</label>
                <div data-testid="private-platform" title="A private show is always saved on the platform this stream is running on."
                  style={{ ...input, marginBottom: 12, color: C.muted }}>
                  {platform} <span style={{ fontSize: 11 }}>· this stream’s platform</span>
                </div>

                <label htmlFor="private-username" style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>Fan username</label>
                <input id="private-username" ref={firstFieldRef} data-testid="private-username" type="text" maxLength={80} autoComplete="off"
                  value={username} onChange={(e) => setUsername(e.target.value)} style={{ ...input, marginBottom: 12 }} />

                <label htmlFor="private-rate" style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>Rate (USD per minute)</label>
                <input id="private-rate" data-testid="private-rate" type="number" min="0" max="1000" step="0.01" inputMode="decimal" placeholder="e.g. 2.50"
                  value={rate} onChange={(e) => setRate(e.target.value)} style={{ ...input, marginBottom: 6 }} />
                {rate !== '' && !rateValid && (
                  <div data-testid="private-rate-error" style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>Enter a rate between $0 and $1,000 per minute.</div>
                )}

                {submitted && engine.actionError && (
                  <div data-testid="private-error" role="alert" style={{ fontSize: 12, color: C.red, margin: '6px 0' }}>{engine.actionError}</div>
                )}

                <button data-testid="private-continue" type="button" disabled={!canContinue}
                  onClick={() => start(rateNum, name)}
                  style={{ ...btn(C.cyan, !canContinue), width: '100%', padding: '10px 14px', fontSize: 14, marginTop: 10 }}>
                  {engine.actionPending ? 'Starting…' : 'Continue'}
                </button>
                <button data-testid="private-skip" type="button" disabled={engine.actionPending}
                  onClick={() => start(null, null)}
                  style={{ ...btn(C.pink, engine.actionPending), width: '100%', padding: '10px 14px', fontSize: 14, marginTop: 8 }}>
                  Skip → Start Private Show
                </button>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
                  Skipping saves the private minutes with no rate, so no earnings estimate is shown for this show.
                </p>
                <button type="button" onClick={close} style={{ marginTop: 10, background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer', width: '100%' }}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
