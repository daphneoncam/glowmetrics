import React from 'react'
import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent } from '@testing-library/react'
import LiveModeAllowanceBar, { freeAllowanceLevel } from '../LiveModeAllowanceBar'
import PrivateShowControl, { privateEstimateUsd, privateStartBlocker } from '../PrivateShowControl'
import { freeClockActiveSeconds, shapeLiveSession } from '../../../lib/liveSession/shape'

const FREE = {
  unlimited: false, timezone: 'America/Los_Angeles', streams_per_week: 2, streams_used: 1,
  active_seconds_per_stream: 2100, resets_at: '2026-11-02T08:00:00Z',
}
const running = (activeSeconds, extra = {}) => ({
  allowance: FREE, limitEnded: null, phase: 'active', dismissLimitEnded: jest.fn(),
  duration: { active_duration_seconds: activeSeconds + 3600, free_active_seconds: activeSeconds, live_substate: 'active', ...extra },
})

describe('LiveModeAllowanceBar', () => {
  test('warning thresholds: 25 min warn, 30 min strong', () => {
    expect(freeAllowanceLevel(24 * 60 + 59)).toBe('ok')
    expect(freeAllowanceLevel(25 * 60)).toBe('warn')
    expect(freeAllowanceLevel(29 * 60 + 59)).toBe('warn')
    expect(freeAllowanceLevel(30 * 60)).toBe('strong')
  })

  test('shows FREE minutes (from first real tip), not stream minutes', () => {
    render(<LiveModeAllowanceBar engine={running(12 * 60 + 5)} />)
    expect(screen.getByTestId('live-allowance-active').dataset.level).toBe('ok')
    expect(screen.getByText(/12:05 of 35:00 active minutes used/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('725')
  })

  test('25-minute warning and 30-minute stronger upgrade warning', () => {
    const { rerender } = render(<LiveModeAllowanceBar engine={running(26 * 60)} />)
    expect(screen.getByTestId('live-allowance-active').dataset.level).toBe('warn')
    expect(screen.getByText(/9:00 of Free Live Mode left/)).toBeTruthy()
    rerender(<LiveModeAllowanceBar engine={running(31 * 60)} />)
    expect(screen.getByTestId('live-allowance-active').dataset.level).toBe('strong')
    expect(screen.getByText(/4:00 left\. Your Free stream ends automatically at 35 active minutes/)).toBeTruthy()
  })

  test('paused: says time is not counting', () => {
    render(<LiveModeAllowanceBar engine={running(10 * 60, { live_substate: 'paused' })} />)
    expect(screen.getByText(/Paused — time isn’t counting/)).toBeTruthy()
  })

  test('idle Free: streams used this week; reset shown when both are used', () => {
    const { rerender } = render(<LiveModeAllowanceBar engine={{ allowance: FREE, phase: 'idle', duration: null }} />)
    expect(screen.getByText(/1 of 2 streams used this week/)).toBeTruthy()
    rerender(<LiveModeAllowanceBar engine={{ allowance: { ...FREE, streams_used: 2 }, phase: 'idle', duration: null }} />)
    expect(screen.getByText(/resets Monday/)).toBeTruthy()
  })

  test('Pro (unlimited) shows nothing', () => {
    const { container } = render(<LiveModeAllowanceBar engine={{ allowance: { unlimited: true }, phase: 'active', duration: { active_duration_seconds: 99999 } }} />)
    expect(container.innerHTML).toBe('')
  })

  test('limit-ended notice', () => {
    const engine = { ...running(0), limitEnded: { id: 's1' } }
    render(<LiveModeAllowanceBar engine={engine} />)
    expect(screen.getByText(/ended at 35 active minutes/)).toBeTruthy()
    fireEvent.click(screen.getByText('Dismiss'))
    expect(engine.dismissLimitEnded).toHaveBeenCalled()
  })
})

describe('Allowance bar — manual plan copy cases', () => {
  test('FC-06 / FC-07: yellow at 25 min shows 10:00 left; red at 30 min shows 5:00 left', () => {
    const { rerender } = render(<LiveModeAllowanceBar engine={running(25 * 60)} />)
    expect(screen.getByText(/10:00 of Free Live Mode left/)).toBeTruthy()
    rerender(<LiveModeAllowanceBar engine={running(30 * 60)} />)
    expect(screen.getByText(/5:00 left\. Your Free stream ends automatically at 35 active minutes/)).toBeTruthy()
  })
  test('AB-03: before the first real tip the week count still shows', () => {
    render(<LiveModeAllowanceBar engine={running(null)} />)
    expect(screen.getByText('Stream 1 of 2 this week')).toBeTruthy()
  })
  test('AB-09: the free bar uses free minutes, never the stream timer', () => {
    // stream timer 1h05, free clock 5 min
    render(<LiveModeAllowanceBar engine={running(5 * 60)} />)
    expect(screen.getByText(/5:00 of 35:00 active minutes used/)).toBeTruthy()
  })
  test('FC-09: paused freezes the bar and says time is not counting', () => {
    render(<LiveModeAllowanceBar engine={running(10 * 60, { live_substate: 'paused' })} />)
    expect(screen.getByText('Paused — time isn’t counting')).toBeTruthy()
  })
})

describe('Free clock (first real tip)', () => {
  test('no real tip yet -> says the clock has not started; no countdown', () => {
    render(<LiveModeAllowanceBar engine={running(null)} />)
    expect(screen.getByTestId('live-allowance-waiting').dataset.clock).toBe('not_started')
    expect(screen.getByText(/35 free minutes start at your first real tip/)).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
  test('clock not known yet -> no guessed number', () => {
    render(<LiveModeAllowanceBar engine={running(undefined)} />)
    expect(screen.getByTestId('live-allowance-waiting').dataset.clock).toBe('unknown')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
  test('freeClockActiveSeconds mirrors the SQL: (paused_at ?? now) - start - paused', () => {
    const now = Date.parse('2026-11-10T12:00:00Z')
    expect(freeClockActiveSeconds({}, now)).toBeUndefined()
    expect(freeClockActiveSeconds({ free_clock: { started_at: null, paused_seconds: 0 } }, now)).toBeNull()
    expect(freeClockActiveSeconds({ free_clock: { started_at: '2026-11-10T11:30:00Z', paused_seconds: 300 } }, now)).toBe(1500)
    // paused: frozen at paused_at
    expect(freeClockActiveSeconds({ paused_at: '2026-11-10T11:40:00Z', free_clock: { started_at: '2026-11-10T11:30:00Z', paused_seconds: 0 } }, now)).toBe(600)
    // tip arrived during an open pause -> 0, never negative
    expect(freeClockActiveSeconds({ paused_at: '2026-11-10T11:20:00Z', free_clock: { started_at: '2026-11-10T11:30:00Z', paused_seconds: 0 } }, now)).toBe(0)
  })
  test('shapeLiveSession carries free_active_seconds and keeps stream timing unchanged', () => {
    const started = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const tip = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const s = shapeLiveSession({ started_at: started, total_paused_seconds: 0, free_clock: { started_at: tip, paused_seconds: 0 } })
    expect(Math.abs(s.active_duration_seconds - 3600)).toBeLessThanOrEqual(1)
    expect(Math.abs(s.free_active_seconds - 600)).toBeLessThanOrEqual(1)
  })
})

describe('PrivateShowControl', () => {
  const liveEngine = (over = {}) => ({
    actionPending: false, actionError: null, privateInterval: null, startPrivate: jest.fn(async () => true), endPrivate: jest.fn(),
    serverSession: { status: 'live', stream_platform: 'BongaCams' }, ...over,
  })

  test('button is always visible; with no session it says to begin Live Mode first', () => {
    const engine = liveEngine({ serverSession: null })
    render(<PrivateShowControl engine={engine} />)
    const start = screen.getByTestId('private-start')
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    expect(screen.getByText('First begin a Live Mode session')).toBeTruthy()
    fireEvent.click(screen.getByTestId('private-blocked-ok'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(engine.startPrivate).not.toHaveBeenCalled()
  })

  test('blocker states mirror the server rule (status must be live)', () => {
    expect(privateStartBlocker(null)).toBe('no_session')
    expect(privateStartBlocker({ status: 'ended' })).toBe('no_session')
    expect(privateStartBlocker({ status: 'starting', stream_platform: 'BongaCams' })).toBe('connecting')
    expect(privateStartBlocker({ status: 'inactive_warning', stream_platform: 'BongaCams' })).toBe('inactive')
    expect(privateStartBlocker({ status: 'live', stream_platform: null })).toBe('no_platform')
    expect(privateStartBlocker({ status: 'live', stream_platform: 'BongaCams' })).toBeNull()
  })

  test('still connecting -> explains, never starts', () => {
    const engine = liveEngine({ serverSession: { status: 'starting', stream_platform: 'BongaCams' } })
    render(<PrivateShowControl engine={engine} />)
    fireEvent.click(screen.getByTestId('private-start'))
    expect(screen.getByText(/still connecting/)).toBeTruthy()
    expect(engine.startPrivate).not.toHaveBeenCalled()
  })

  test('Yes / No prompt names the stream platform; No closes without starting', () => {
    const engine = liveEngine()
    render(<PrivateShowControl engine={engine} />)
    fireEvent.click(screen.getByTestId('private-start'))
    expect(screen.getByText('Starting private show on BongaCams?')).toBeTruthy()
    fireEvent.click(screen.getByTestId('private-confirm-no'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(engine.startPrivate).not.toHaveBeenCalled()
  })

  test('Yes -> details; Continue needs username + valid rate; platform is locked to the stream', async () => {
    const engine = liveEngine()
    render(<PrivateShowControl engine={engine} />)
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.click(screen.getByTestId('private-confirm-yes'))
    expect(screen.getByTestId('private-platform').textContent).toMatch(/BongaCams/)
    expect(screen.getByTestId('private-platform').tagName).not.toBe('INPUT')
    const cont = screen.getByTestId('private-continue')
    expect(cont.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '2.5' } })
    expect(cont.disabled).toBe(true) // no username yet
    fireEvent.change(screen.getByTestId('private-username'), { target: { value: '  fan_one ' } })
    expect(cont.disabled).toBe(false)
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '1001' } })
    expect(cont.disabled).toBe(true)
    expect(screen.getByTestId('private-rate-error')).toBeTruthy()
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '2.5' } })
    fireEvent.click(cont)
    expect(engine.startPrivate).toHaveBeenCalledWith(2.5, 'fan_one')
  })

  test('Skip starts the private show with no rate and no username (never 0)', () => {
    const engine = liveEngine()
    render(<PrivateShowControl engine={engine} />)
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.click(screen.getByTestId('private-confirm-yes'))
    fireEvent.click(screen.getByTestId('private-skip'))
    expect(engine.startPrivate).toHaveBeenCalledWith(null, null)
  })

  test('a refused start keeps the pop-up open and shows the server message', async () => {
    const engine = liveEngine({ startPrivate: jest.fn(async () => false), actionError: 'Go live before starting a private show.' })
    render(<PrivateShowControl engine={engine} />)
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.click(screen.getByTestId('private-confirm-yes'))
    fireEvent.click(screen.getByTestId('private-skip'))
    expect(await screen.findByTestId('private-error')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  test('open interval: elapsed time and the DB estimate model (rate x minutes); End only ends private', () => {
    const started = new Date(Date.now() - 90 * 1000).toISOString()
    const engine = liveEngine({ privateInterval: { started_at: started, rate_per_minute: 2, platform: 'BongaCams', username: 'fan_one' } })
    render(<PrivateShowControl engine={engine} />)
    expect(screen.getByTestId('private-elapsed').textContent).toMatch(/^1:3\d$/)
    expect(screen.getByTestId('private-estimate').textContent).toMatch(/~\$3\.0\d/)
    expect(screen.getByText(/Private with fan_one · BongaCams/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('private-end'))
    expect(engine.endPrivate).toHaveBeenCalled()
  })

  test('skipped private shows no estimate and no "$0.00/min"', () => {
    const engine = liveEngine({ privateInterval: { started_at: new Date().toISOString(), rate_per_minute: null, platform: 'BongaCams', username: null } })
    render(<PrivateShowControl engine={engine} />)
    expect(screen.getByTestId('private-estimate').textContent).toMatch(/—\s*no rate entered/)
    expect(screen.getByTestId('private-estimate').textContent).not.toMatch(/\$0\.00/)
    expect(screen.getByText(/^🔒 Private · BongaCams$/)).toBeTruthy()
  })

  // ── Manual test plan cases automated (IDs from the plan) ──
  const openDetails = () => {
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.click(screen.getByTestId('private-confirm-yes'))
  }

  test('PF-02: Esc and a click outside both close the pop-up without starting', () => {
    const engine = liveEngine()
    render(<PrivateShowControl engine={engine} />)
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.click(screen.getByTestId('private-overlay'))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('private-start'))
    fireEvent.click(screen.getByRole('dialog')) // a click inside does not close
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(engine.startPrivate).not.toHaveBeenCalled()
  })

  test('PF-03 / MB-05 / MB-06: details step is a labelled dialog, focus lands on Fan username', () => {
    render(<PrivateShowControl engine={liveEngine()} />)
    openDetails()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Private show details')
    expect(document.activeElement).toBe(screen.getByLabelText('Fan username'))
    expect(screen.getByLabelText('Rate (USD per minute)').getAttribute('inputmode')).toBe('decimal')
    expect(screen.queryByLabelText(/platform/i)).toBeNull() // platform is not an editable field
  })

  test('PF-06 / PF-07: rate bounds — invalid values blocked with a message, 0 and 1000 allowed', () => {
    const engine = liveEngine()
    render(<PrivateShowControl engine={engine} />)
    openDetails()
    fireEvent.change(screen.getByTestId('private-username'), { target: { value: 'fan' } })
    for (const bad of ['-1', '1001', '-0.01']) {
      fireEvent.change(screen.getByTestId('private-rate'), { target: { value: bad } })
      expect(screen.getByTestId('private-continue').disabled).toBe(true)
      expect(screen.getByTestId('private-rate-error')).toBeTruthy()
    }
    for (const good of ['0', '1000', '1e3', '2.5']) {
      fireEvent.change(screen.getByTestId('private-rate'), { target: { value: good } })
      expect(screen.getByTestId('private-continue').disabled).toBe(false)
      expect(screen.queryByTestId('private-rate-error')).toBeNull()
    }
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('private-continue'))
    expect(engine.startPrivate).toHaveBeenCalledWith(0, 'fan')
  })

  test('PF-09: username field is capped at 80 characters', () => {
    render(<PrivateShowControl engine={liveEngine()} />)
    openDetails()
    expect(screen.getByTestId('private-username').getAttribute('maxlength')).toBe('80')
  })

  test('PF-10: a username containing HTML is shown as plain text, never rendered', () => {
    const engine = liveEngine({ privateInterval: { started_at: new Date().toISOString(), rate_per_minute: 1, platform: 'BongaCams', username: '<b>x</b><img src=x onerror=alert(1)>' } })
    const { container } = render(<PrivateShowControl engine={engine} />)
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/<b>x<\/b>/)).toBeTruthy()
  })

  test('PF-11: Skip drops anything typed and sends no rate / no username', () => {
    const engine = liveEngine()
    render(<PrivateShowControl engine={engine} />)
    openDetails()
    fireEvent.change(screen.getByTestId('private-username'), { target: { value: 'fan' } })
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('private-skip'))
    expect(engine.startPrivate).toHaveBeenCalledWith(null, null)
  })

  test('PF-13: while a start is in flight, Continue and Skip are disabled', () => {
    render(<PrivateShowControl engine={liveEngine({ actionPending: true })} />)
    // the button itself is disabled while pending, so open via a fresh render
    expect(screen.getByTestId('private-start').disabled).toBe(true)
  })

  test('PF-13b: details buttons disable when the engine reports a pending action', () => {
    const engine = liveEngine()
    const { rerender } = render(<PrivateShowControl engine={engine} />)
    openDetails()
    fireEvent.change(screen.getByTestId('private-username'), { target: { value: 'fan' } })
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '2' } })
    rerender(<PrivateShowControl engine={{ ...engine, actionPending: true }} />)
    expect(screen.getByTestId('private-continue').disabled).toBe(true)
    expect(screen.getByTestId('private-skip').disabled).toBe(true)
    expect(screen.getByTestId('private-continue').textContent).toBe('Starting…')
  })

  test('PF-15: Cancel keeps typed fields for the same page visit', () => {
    render(<PrivateShowControl engine={liveEngine()} />)
    openDetails()
    fireEvent.change(screen.getByTestId('private-username'), { target: { value: 'fan_keep' } })
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    openDetails()
    expect(screen.getByTestId('private-username').value).toBe('fan_keep')
  })

  test('PF-16: after a successful start the fields are empty next time', async () => {
    const engine = liveEngine()
    const { rerender } = render(<PrivateShowControl engine={engine} />)
    openDetails()
    fireEvent.change(screen.getByTestId('private-username'), { target: { value: 'fan' } })
    fireEvent.change(screen.getByTestId('private-rate'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('private-continue'))
    await screen.findByTestId('private-start') // dialog closed after success
    await new Promise((r) => setTimeout(r, 0))
    rerender(<PrivateShowControl engine={{ ...engine }} />)
    openDetails()
    expect(screen.getByTestId('private-username').value).toBe('')
    expect(screen.getByTestId('private-rate').value).toBe('')
  })

  test('SP-06 / SP-07: if the stream ends while the pop-up is open, it switches to "First begin a Live Mode session"', () => {
    const engine = liveEngine()
    const { rerender } = render(<PrivateShowControl engine={engine} />)
    openDetails()
    rerender(<PrivateShowControl engine={{ ...engine, serverSession: null }} />)
    expect(screen.getByText('First begin a Live Mode session')).toBeTruthy()
    expect(screen.queryByTestId('private-continue')).toBeNull()
  })

  test('SP-08: tooltip matches each state', () => {
    const { rerender } = render(<PrivateShowControl engine={liveEngine({ serverSession: null })} />)
    expect(screen.getByTestId('private-start').title).toBe('First begin a Live Mode session')
    rerender(<PrivateShowControl engine={liveEngine({ serverSession: { status: 'starting', stream_platform: 'BongaCams' } })} />)
    expect(screen.getByTestId('private-start').title).toBe('Your stream is still connecting')
    rerender(<PrivateShowControl engine={liveEngine()} />)
    expect(screen.getByTestId('private-start').title).toBe('Private on BongaCams')
  })

  test('OP-04: a private started in another tab closes this tab\'s open pop-up', () => {
    const engine = liveEngine()
    const { rerender } = render(<PrivateShowControl engine={engine} />)
    openDetails()
    rerender(<PrivateShowControl engine={{ ...engine, privateInterval: { started_at: new Date().toISOString(), rate_per_minute: 2, platform: 'BongaCams', username: 'x' } }} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('private-open')).toBeTruthy()
  })

  test('OP-02: estimate = rate x minutes (10 min at $2.00 = $20.00)', () => {
    expect(privateEstimateUsd({ started_at: '2026-11-10T10:00:00Z', rate_per_minute: 2 }, Date.parse('2026-11-10T10:10:00Z'))).toBe(20)
    expect(privateEstimateUsd({ started_at: '2026-11-10T10:00:00Z', rate_per_minute: 0 }, Date.parse('2026-11-10T10:10:00Z'))).toBe(0)
  })

  test('MB-05: Tab stays inside the pop-up (wraps last -> first, Shift+Tab first -> last)', () => {
    render(<PrivateShowControl engine={liveEngine()} />)
    openDetails()
    const cancel = screen.getByText('Cancel')
    cancel.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByTestId('private-username'))
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
  })

  test('MB-05: closing returns focus to the Start Private button', () => {
    render(<PrivateShowControl engine={liveEngine()} />)
    openDetails()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByTestId('private-start'))
  })

  test('MB-04 / MB-08: pop-up never exceeds the screen height and scrolls inside', () => {
    render(<PrivateShowControl engine={liveEngine()} />)
    openDetails()
    const style = screen.getByRole('dialog').style
    expect(style.maxHeight).toBe('calc(100vh - 32px)')
    expect(style.overflowY).toBe('auto')
  })

  test('no estimate is invented without a rate', () => {
    expect(privateEstimateUsd({ started_at: new Date().toISOString(), rate_per_minute: null })).toBeNull()
    expect(privateEstimateUsd({ started_at: '2026-10-28T10:00:00Z', rate_per_minute: 3 }, Date.parse('2026-10-28T10:10:00Z'))).toBe(30)
  })
})

describe('Live page always shows the private button', () => {
  const src = fs.readFileSync(path.join(__dirname, '../page.js'), 'utf8')
  test('not gated on status === live (the control explains instead)', () => {
    expect(src).not.toMatch(/status === 'live' && \(\s*<PrivateShowControl/)
    expect(src).toMatch(/<PrivateShowControl engine=\{engine\} \/>/)
  })
})

describe('Dashboard Live Mode uses only the server session', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/page.js'), 'utf8')
  test('no local-only Live state writers remain', () => {
    expect(src).not.toMatch(/setLiveActive|setLiveStartTime/)
  })
  test('Go Live / End / Pause / Resume call the engine', () => {
    expect(src).toMatch(/liveEngine\.goLive\(livePlatform\)/)
    expect(src).toMatch(/onClick=\{liveEngine\.stop\}/)
    expect(src).toMatch(/onClick=\{liveEngine\.pause\}/)
    expect(src).toMatch(/onClick=\{liveEngine\.resume\}/)
  })
  test('Private Mode and the allowance bar sit inside the dashboard Live experience', () => {
    expect(src).toMatch(/<PrivateShowControl engine=\{liveEngine\} \/>/)
    expect(src).toMatch(/<LiveModeAllowanceBar engine=\{liveEngine\} \/>/)
  })
})
