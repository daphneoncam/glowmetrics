/**
 * Renders the REAL Dashboard (app/dashboard/page.js) against a mocked Supabase
 * client that executes queries, with realistic tip / private-session / Live
 * data. Unit tests and `next build` never execute page.js, which is how the
 * undefined thisMonthStart / prevMonthStart crash (#731 → #748) and the
 * TitleGenerator creatorTz crash (#743) shipped. This test fails on render
 * errors (captured by an error boundary, because jest.setup.js silences
 * console.error) and checks the loading-failure behavior from #747.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { fakeSupabase } from '../../../lib/dataLoad/__tests__/fakeSupabase'
import { buildAccount, buildEntitlementAccount } from './dashboardFixtures'

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))
let mockDb
jest.mock('../../../lib/supabase', () => ({ supabase: new Proxy({}, { get: (_t, p) => mockDb[p] }) }))

import Dashboard from '../page'

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <div data-testid="crash">CRASH: {String(this.state.error?.message)}</div> : this.props.children }
}

let account
const installBrowserStubs = () => {
  window.scrollTo = jest.fn()
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
  global.IntersectionObserver = global.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} }
  HTMLCanvasElement.prototype.getContext = HTMLCanvasElement.prototype.getContext || (() => null)
  global.fetch = jest.fn(async (url) => {
    const u = String(url)
    const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body })
    if (u.startsWith('/api/live/sessions/recent')) return json({ shows: account.shows })
    if (u.startsWith('/api/live/sessions/private-earnings')) return json({ intervals: [] })
    if (u.startsWith('/api/live/session')) return json({ session: null })
    return json({})
  })
}

// Accounts created before the paywall-test cutoff keep dashboard access
// (lib/paywallTest.js), so the fixture user is a legacy account by default.
const LEGACY_CREATED_AT = '2026-10-01T10:00:00Z'
const NEW_CREATED_AT = '2026-11-20T10:00:00Z'
const mount = async ({ plan = 'pro', tab = 'overview', dbOpts = {}, build = buildAccount, createdAt = LEGACY_CREATED_AT } = {}) => {
  account = build({ plan })
  mockDb = fakeSupabase(account.tables, { user: { ...account.user, created_at: createdAt }, ...dbOpts })
  localStorage.setItem('camcash_tab', tab)
  let utils
  await act(async () => { utils = render(<Boundary><Dashboard /></Boundary>) })
  return utils
}
const notCrashed = () => expect(screen.queryByTestId('crash')?.textContent).toBeUndefined()

beforeEach(() => { localStorage.clear(); installBrowserStubs(); mockRouter.replace.mockClear() })

test('paywall test: a new account with no paid plan or trial is sent to pricing', async () => {
  await mount({ plan: 'free', tab: 'overview', createdAt: NEW_CREATED_AT })
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pricing?paywall=1'), { timeout: 10000 })
})

test('paywall test: a new account on a paid plan is not redirected', async () => {
  await mount({ plan: 'pro', tab: 'overview', createdAt: NEW_CREATED_AT })
  await waitFor(() => expect(screen.getByText('Meaningful Sessions')).toBeTruthy(), { timeout: 30000 })
  expect(mockRouter.replace).not.toHaveBeenCalledWith('/pricing?paywall=1')
})

jest.setTimeout(60000)

test('Pro, complete load: the Overview renders with tips (month-over-month cards run), no warning', async () => {
  await mount({ plan: 'pro', tab: 'overview' })
  await waitFor(() => expect(screen.getByText('Meaningful Sessions')).toBeTruthy(), { timeout: 30000 })
  notCrashed()
  expect(screen.queryByTestId('load-warning-banner')).toBeNull()
})

test('Pro, complete load: Sessions renders real rows and comparison verdicts, no warning', async () => {
  await mount({ plan: 'pro', tab: 'sessions' })
  await waitFor(() => expect(screen.getByTestId('sessions-overview')).toBeTruthy(), { timeout: 30000 })
  notCrashed()
  expect(screen.getAllByTestId(/^history-/).length).toBeGreaterThan(0)
  expect(screen.queryAllByTestId(/^row-vs-/).length).toBeGreaterThan(0) // complete load: verdicts allowed
  expect(screen.queryByTestId('load-warning-banner')).toBeNull()
})

test('Free, complete load: Sessions renders and nothing crashes (the Free window is applied after loading)', async () => {
  await mount({ plan: 'free', tab: 'sessions' })
  await waitFor(() => expect(screen.getByTestId('sessions-overview')).toBeTruthy(), { timeout: 30000 })
  notCrashed()
  expect(screen.getAllByTestId(/^history-/).length).toBeGreaterThan(0)
  expect(screen.queryByTestId('load-warning-banner')).toBeNull()
})

describe('loading failures (#747)', () => {
  const failing = { tips: false, paid: false }
  const failIf = ({ table, from }) => (from !== null && failing[table === 'paid_sessions' ? 'paid' : 'tips'] ? 'error' : null)
  beforeEach(() => { failing.tips = false; failing.paid = false })

  test('a failed private-session load shows the warning + Retry, removes every Sessions verdict, and Retry recovers', async () => {
    failing.paid = true
    await mount({ plan: 'pro', tab: 'sessions', dbOpts: { fail: failIf } })
    const banner = await screen.findByTestId('load-warning-banner', {}, { timeout: 30000 })
    notCrashed()
    expect(banner.getAttribute('data-kind')).toBe('partial')
    expect(screen.getByTestId('load-warning-message').textContent).toMatch(/private sessions couldn't be loaded/)
    await waitFor(() => expect(screen.getByTestId('sessions-overview')).toBeTruthy())
    expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0) // incomplete history: no verdicts
    expect(screen.getByTestId('details-vs-unknown').textContent).toMatch(/can.t be confirmed/)

    failing.paid = false // the outage ends
    await act(async () => { fireEvent.click(screen.getByTestId('load-warning-retry')) })
    await waitFor(() => expect(screen.queryByTestId('load-warning-banner')).toBeNull(), { timeout: 30000 })
    notCrashed()
    expect(screen.queryAllByTestId(/^row-vs-/).length).toBeGreaterThan(0) // verdicts are back
  })

  test('a failed tips load: the dashboard still renders (no crash) with a persistent warning that stays while Retry keeps failing', async () => {
    failing.tips = true
    await mount({ plan: 'pro', tab: 'overview', dbOpts: { fail: failIf } })
    const banner = await screen.findByTestId('load-warning-banner', {}, { timeout: 30000 })
    notCrashed()
    expect(banner.getAttribute('data-kind')).toBe('partial')
    expect(screen.getByTestId('load-warning-message').textContent).toMatch(/tips couldn't be loaded/)
    await act(async () => { fireEvent.click(screen.getByTestId('load-warning-retry')) })
    await waitFor(() => expect(screen.getByTestId('load-warning-retry').disabled).toBe(false), { timeout: 30000 })
    expect(screen.getByTestId('load-warning-banner')).toBeTruthy() // still failing: the warning does not go away
    notCrashed()
  })
})

describe('Free / Pro restrictions in the real dashboard', () => {
  // dashboardFixtures adds `ancient_bc_fan`: BongaCams-only, 95 days ago. Primary platform = Chaturbate,
  // so Free's 31-day window hides this fan; Pro sees full history.
  test('Pro: the old fan appears in Top Fans (full history)', async () => {
    await mount({ plan: 'pro', tab: 'whales' })
    await waitFor(() => expect(document.body.innerHTML).toContain('ancient_bc_fan'), { timeout: 30000 })
    notCrashed()
  })

  test.each(['whales', 'overview', 'sessions'])('Free: restricted older history never reaches the %s tab', async (tab) => {
    await mount({ plan: 'free', tab })
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull(), { timeout: 30000 })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    notCrashed()
    expect(document.body.innerHTML).not.toContain('ancient_bc_fan')
  })
})

describe('failure → retry → recovery, and stale data after a failed refresh', () => {
  const failing = { tips: false, paid: false }
  const failIf = ({ table, from }) => (from !== null && failing[table === 'paid_sessions' ? 'paid' : 'tips'] ? 'error' : null)
  beforeEach(() => { failing.tips = false; failing.paid = false })

  test('Free + failed tips load: warning, no verdicts, no restricted rows', async () => {
    failing.tips = true
    await mount({ plan: 'free', tab: 'sessions', dbOpts: { fail: failIf } })
    await screen.findByTestId('load-warning-banner', {}, { timeout: 30000 })
    notCrashed()
    expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain('ancient_bc_fan')
  })

  test('a failed TIPS load recovers on Retry: warning clears, data and verdicts appear', async () => {
    failing.tips = true
    await mount({ plan: 'pro', tab: 'sessions', dbOpts: { fail: failIf } })
    await screen.findByTestId('load-warning-banner', {}, { timeout: 30000 })
    expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0)
    failing.tips = false
    await act(async () => { fireEvent.click(screen.getByTestId('load-warning-retry')) })
    await waitFor(() => expect(screen.queryByTestId('load-warning-banner')).toBeNull(), { timeout: 30000 })
    await waitFor(() => expect(screen.queryAllByTestId(/^row-vs-/).length).toBeGreaterThan(0), { timeout: 30000 })
    notCrashed()
  })

  test('complete load, then a refresh FAILS: data is kept, the warning says "last complete update", and "Updated" does not advance', async () => {
    // Fake only Date (timers stay real) so a wrongly-advanced "Updated" time would be visible.
    const T0 = new Date('2026-11-04T15:00:00Z').getTime()
    jest.useFakeTimers({ now: T0, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance'] })
    try {
      await mount({ plan: 'pro', tab: 'sessions', dbOpts: { fail: failIf } })
      await waitFor(() => expect(screen.queryAllByTestId(/^row-vs-/).length).toBeGreaterThan(0), { timeout: 30000 })
      const updatedBefore = document.querySelector('.recently-updated').textContent
      const rowsBefore = screen.getAllByTestId(/^history-/).length

      let hidden = true
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }) // hidden at T0
      jest.setSystemTime(T0 + 16 * 60 * 1000) // back 16 minutes later → the dashboard refreshes
      failing.tips = true
      hidden = false
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })

      const banner = await screen.findByTestId('load-warning-banner', {}, { timeout: 30000 })
      expect(banner.getAttribute('data-kind')).toBe('stale')
      expect(screen.getByTestId('load-warning-message').textContent).toMatch(/last complete update/)
      expect(screen.getAllByTestId(/^history-/).length).toBe(rowsBefore) // complete data was NOT replaced
      expect(screen.queryAllByTestId(/^row-vs-/).length).toBeGreaterThan(0) // the snapshot on screen is complete
      expect(document.querySelector('.recently-updated').textContent).toBe(updatedBefore) // a failed refresh must not look fresh
      notCrashed()
    } finally {
      delete document.hidden
      jest.useRealTimers()
    }
  })
})

describe('Free Sessions entitlement: visible history, selected-session details, buckets and contributors', () => {
  const click = (el) => act(async () => { fireEvent.click(el.querySelector('button') || el) })
  const money = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''))
  const rowIds = () => screen.getAllByTestId(/^history-/).map((e) => e.getAttribute('data-testid'))
  const openSessions = async (plan) => {
    await mount({ plan, tab: 'sessions', build: buildEntitlementAccount })
    await waitFor(() => expect(screen.getAllByTestId(/^history-/).length).toBeGreaterThan(0), { timeout: 30000 })
    notCrashed()
    return account.expected
  }
  const select = async (id) => { await click(screen.getByTestId(id)) }
  const bucketTotals = () => screen.getAllByTestId('bucket-row').reduce((a, r) => {
    const td = r.querySelectorAll('td'); return { usd: a.usd + money(td[1].textContent), tips: a.tips + Number(td[3].textContent) }
  }, { usd: 0, tips: 0 })
  const fanNames = () => screen.getAllByTestId('fan-driver').map((f) => f.querySelector('span[style*="font-weight: 900"]')?.textContent || f.textContent).sort()

  test('Free: restricted sessions are not listed; the straddling session shows only in-window tips in details, buckets and contributors', async () => {
    const x = await openSessions('free')
    const ids = rowIds()
    expect(ids).toContain(x.latestId)
    expect(ids).toContain(x.straddleFreeId)
    expect(ids).not.toContain(x.restrictedId) // 40-day-old BongaCams session: outside Free's window
    expect(ids).not.toContain(x.straddleProId) // the full (unwindowed) session must not exist for Free

    await select(x.straddleFreeId)
    expect(screen.getByTestId('details-total').textContent).toBe('$8.00') // $5 + $3, not the hidden $10
    expect(screen.getByTestId('details-vs-partial').textContent).toMatch(/started before your Free history window/)

    await click(screen.getByTestId('details-tab-timeline'))
    const b = bucketTotals()
    expect(b.usd).toBeCloseTo(8, 2)
    expect(b.tips).toBe(2)

    await click(screen.getByTestId('details-tab-fans'))
    expect(fanNames()).toEqual(['vis_a', 'vis_b'])

    for (const name of ['straddle_hidden_fan', 'restricted_only_fan']) expect(document.body.innerHTML).not.toContain(name)
  })

  test('Pro (same account): full history is listed and the same session includes the earlier tip', async () => {
    const x = await openSessions('pro')
    const ids = rowIds()
    expect(ids).toContain(x.restrictedId)
    expect(ids).toContain(x.straddleProId)
    expect(ids).not.toContain(x.straddleFreeId)

    await select(x.straddleProId)
    expect(screen.getByTestId('details-total').textContent).toBe('$18.00')
    await click(screen.getByTestId('details-tab-timeline'))
    const b = bucketTotals()
    expect(b.usd).toBeCloseTo(18, 2)
    expect(b.tips).toBe(3)
    await click(screen.getByTestId('details-tab-fans'))
    expect(fanNames()).toEqual(['straddle_hidden_fan', 'vis_a', 'vis_b'])
  })
})
