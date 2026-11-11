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
