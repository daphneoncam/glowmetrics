/**
 * Platforms — reference build. Checks that every section renders, that the
 * reporting period really filters the figures (and Free is clamped to 31 days),
 * that Live-only metrics stay honest for imported history, and that existing
 * navigation (Unified/Split, Go Live, platform click-through) still works.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PlatformsIntelligence, { PlatformCell } from '../PlatformsIntelligence'
import { buildAccount } from './dashboardFixtures'
import { liveShow } from '../../../lib/sessions/__fixtures__/batch1-fixtures'
import { aggregateRows, applyFreeAnalysisWindow } from '../../../lib/analytics'

const TZ = 'America/New_York'
const NOW = Date.now()
const account = buildAccount({ now: NOW, plan: 'pro' })
const tips = account.tables.tips
const money = (s) => Number(String(s).replace(/[$,]/g, ''))

function renderPage({ isPro = true, data = tips, shows = [], ...rest } = {}) {
  const useTips = isPro ? data : applyFreeAnalysisWindow(data, { windowDays: 31, unlimitedPlatform: 'Chaturbate' })
  const analytics = useTips.length ? aggregateRows(useTips, TZ) : null
  return render(<PlatformsIntelligence analytics={analytics} tips={useTips} shows={shows} tz={TZ} isPro={isPro} onOpenPlanner={() => {}} onGoLive={() => {}} {...rest} />)
}
const setPeriod = (v) => fireEvent.click(screen.getByTestId(`pu-period-${v}`))

test('every reference section renders in order', () => {
  const { container } = renderPage()
  for (const label of ['Total earned', 'Avg $/hour', 'Total hours', 'Top platform', 'Best window (all platforms)']) {
    expect(container.textContent).toContain(label)
  }
  for (const s of ['CamCash noticed', 'Platform performance', 'Historical trends', 'Audience evolution', 'Timing opportunities', 'Records and milestones']) {
    expect(screen.getByLabelText(new RegExp(s, 'i'))).toBeTruthy()
  }
  for (const r of ['All-time high', 'Growth streak', 'Audience milestone', 'Platform growth']) expect(container.textContent).toContain(r)
  expect(screen.getAllByTestId(/^pu-card-/).length).toBeGreaterThan(0)
})

test('Platform growth shows the approved record or an honest empty state, never a placeholder', () => {
  renderPage()
  const card = screen.getByTestId('rec-platform')
  expect(card.textContent).not.toMatch(/Definition pending/)
  expect(card.textContent).toMatch(/best month-over-month gain|None yet/)
})

test('Platform growth uses a single platform and the $50 minimum base', () => {
  const nowD = new Date(NOW)
  const monthStart = (back) => Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - back, 15, 16)
  const t = [
    { id: 1, date_time: new Date(monthStart(2)).toISOString(), platform: 'chaturbate', username: 'a', usd: 100, live_session_id: null, source: 'upload' },
    { id: 2, date_time: new Date(monthStart(1)).toISOString(), platform: 'chaturbate', username: 'b', usd: 250, live_session_id: null, source: 'upload' },
    { id: 3, date_time: new Date(monthStart(2)).toISOString(), platform: 'bongacams', username: 'c', usd: 5, live_session_id: null, source: 'upload' },
    { id: 4, date_time: new Date(monthStart(1)).toISOString(), platform: 'bongacams', username: 'd', usd: 45, live_session_id: null, source: 'upload' },
  ]
  renderPage({ data: t })
  const card = screen.getByTestId('rec-platform')
  expect(card.textContent).toMatch(/Chaturbate/)
  expect(card.textContent).toMatch(/\+150%/)       // BongaCams' +800% from a $5 base is excluded
  expect(card.textContent).not.toMatch(/BongaCams/)
})

test('the reporting period filters the figures (Pro: 30 vs 90 days)', () => {
  renderPage({ isPro: true })
  setPeriod(30)
  const thirty = money(screen.getByTestId('pu-total').textContent)
  setPeriod(90)
  const ninety = money(screen.getByTestId('pu-total').textContent)
  expect(ninety).toBeGreaterThan(thirty)
  expect(thirty).toBeGreaterThan(0)
})

test('Free: choosing 90 days is clamped to 31 days, with the limitation stated', () => {
  renderPage({ isPro: false })
  setPeriod(90)
  expect(screen.getByTestId('pu-period-note').textContent).toMatch(/Free shows the last 31 days/)
  // Free never gets a prior-period comparison (that data is outside the entitled window)
  expect(screen.getByLabelText('Business summary').textContent).toMatch(/Pro: change vs prior period/)
})

test('Free and Pro 90-day totals differ, and Free never exceeds its 31-day window', () => {
  const free = renderPage({ isPro: false })
  setPeriod(90)
  const freeTotal = money(screen.getByTestId('pu-total').textContent)
  free.unmount()
  renderPage({ isPro: true })
  setPeriod(90)
  const proTotal = money(screen.getByTestId('pu-total').textContent)
  expect(freeTotal).toBeLessThanOrEqual(proTotal)
})

test('imported history alone: no estimated $/hr or hours are shown (no activity-span estimates)', () => {
  renderPage()
  expect(screen.getByTestId('pu-hourly').textContent).toBe('—')
  expect(screen.getByTestId('pu-hours').textContent).toBe('—')
  expect(screen.getByTestId('pu-best-window').textContent).toBe('Not ranked yet')
  // One translucent progress card instead of stacked "not enough data" rows
  expect(screen.getAllByTestId('pu-window-building')).toHaveLength(1)
  expect(screen.queryAllByTestId('pu-window')).toHaveLength(0)
  expect(screen.getByTestId('pu-window-building').textContent).toMatch(/3-hour windows|streaming dates/)
})

test('a verified Live show supplies the verified hours and $/hr', () => {
  const live = liveShow({ id: 'live-1', platform: 'Chaturbate', startedAt: new Date(NOW - 3 * 86400000).toISOString(), minutes: 120, publicUsd: 60, privateUsd: 0, tipCount: 2, uniqueTippers: 2 })
  renderPage({ shows: [live] })
  expect(screen.getByTestId('pu-hours').textContent).toBe('2h')
  expect(screen.getByTestId('pu-hourly').textContent).toBe('$30.00')
})

test('the monthly trend switches metric and is labelled per platform', () => {
  renderPage()
  const audience = screen.getByRole('button', { name: 'Audience' })
  fireEvent.click(audience)
  expect(audience.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText(/Audience by month and platform/)).toBeTruthy()
  expect(screen.getByText(/gaps are months without verified data/)).toBeTruthy()
})

test('platform cards open the existing Split view', () => {
  renderPage()
  const first = screen.getAllByTestId(/^pu-card-/)[0]
  fireEvent.click(first)
  expect(screen.getByTestId('pi-view-split').getAttribute('aria-pressed')).toBe('true')
})

test('Go Live and the Unified / Split toggle are kept', () => {
  const onGoLive = jest.fn()
  renderPage({ onGoLive })
  fireEvent.click(screen.getByTestId('pi-go-live'))
  expect(onGoLive).toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('pi-view-split'))
  expect(screen.getByTestId('pi-view-split').getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByTestId('pi-view-unified'))
  expect(screen.getByTestId('platforms-unified')).toBeTruthy()
})

test('the detailed tables stay available in a collapsed Full breakdown', () => {
  renderPage()
  const toggle = screen.getByTestId('pi-breakdown-toggle')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  const body = screen.getByTestId('pi-breakdown')
  for (const t of ['Your cam business', 'Where your money comes from', 'Your next best move']) expect(body.textContent).toContain(t)
})

test('no data: honest empty state instead of the page', () => {
  renderPage({ data: [] })
  expect(screen.queryByTestId('platforms-unified')).toBeNull()
  expect(screen.getByText(/No platform has enough session data/)).toBeTruthy()
})

test('audience counts are per platform:username (same name on two platforms = two fans)', () => {
  const t = [
    { id: 1, date_time: new Date(NOW - 2 * 86400000).toISOString(), platform: 'chaturbate', username: 'Shared', usd: 5, live_session_id: null, source: 'upload' },
    { id: 2, date_time: new Date(NOW - 2 * 86400000).toISOString(), platform: 'bongacams', username: 'Shared', usd: 5, live_session_id: null, source: 'upload' },
  ]
  const { container } = renderPage({ data: t })
  // Active fans cell (first figure in the audience card)
  expect(screen.getByLabelText('Audience evolution').querySelector('b').textContent).toBe('2')
  expect(container.textContent).toContain('Fans are counted per platform')
})


// ── Phase A: Sessions styling, approved fixes ────────────────────────────────
const DAYMS = 86400000
const row = (id, daysAgo, platform, username, usd) => ({ id, date_time: new Date(NOW - daysAgo * DAYMS).toISOString(), platform, username, usd, live_session_id: null, source: 'upload' })

test('Free records use only the Free reporting window; Pro uses full history', () => {
  // Chaturbate is Free's primary platform, so old Chaturbate rows ARE in Free's entitled data:
  // records must still ignore them for Free.
  const t = [row(1, 60, 'chaturbate', 'old', 500), row(2, 60, 'chaturbate', 'old2', 400), row(3, 5, 'chaturbate', 'new', 20), row(4, 5, 'chaturbate', 'new2', 15)]
  const free = renderPage({ isPro: false, data: t })
  expect(screen.getByTestId('rec-high').textContent).toMatch(/\$35\.00/)
  expect(screen.getByTestId('rec-high').textContent).not.toMatch(/\$900\.00/)
  expect(screen.getByTestId('rec-scope').textContent).toMatch(/Last 30 days · Free/)
  free.unmount()
  renderPage({ isPro: true, data: t })
  expect(screen.getByTestId('rec-high').textContent).toMatch(/\$900\.00/)
  expect(screen.getByTestId('rec-scope').textContent).toBe('All history')
})

test('platform colours follow the approved mockup on this page; Sessions PlatformCell keeps its own', () => {
  renderPage()
  const badge = (name) => screen.getByTestId(`pu-card-${name}`).querySelector('span')
  expect(badge('Chaturbate').style.background).toBe('rgb(34, 211, 238)')  // cyan
  expect(badge('BongaCams').style.background).toBe('rgb(236, 72, 153)')   // magenta
  expect(badge('MyFreeCams').style.background).toBe('rgb(168, 85, 247)')  // violet
  // Split view platform buttons use the same mapping
  fireEvent.click(screen.getByTestId('pi-view-split'))
  const chaturbateBtn = screen.getAllByRole('button').find((b) => b.textContent === 'Chaturbate')
  expect(chaturbateBtn.querySelector('span').style.background).toBe('rgb(34, 211, 238)')
  // The shared PlatformCell (used by Sessions) is unchanged by default
  const { container } = render(<PlatformCell platform="Chaturbate" />)
  expect(container.querySelector('span span').style.background).toBe('rgb(168, 85, 247)')
})

test('trend pills: Pro only, from the prior period of the same length, labelled with the engine bands', () => {
  const pro = renderPage({ isPro: true })
  const pills = screen.queryAllByTestId(/^pu-state-/)
  expect(pills.length).toBeGreaterThan(0)
  for (const p of pills) expect(p.textContent).toMatch(/· (Surging|Growing|Steady|Declining)$/)
  pro.unmount()
  renderPage({ isPro: false })
  expect(screen.queryAllByTestId(/^pu-state-/)).toHaveLength(0)
})

test('Sessions-style header: period pills, freshness status, hero actions', () => {
  const onOpenPlanner = jest.fn()
  renderPage({ onOpenPlanner })
  expect(screen.getByTestId('pu-period-30').getAttribute('aria-pressed')).toBe('true')
  setPeriod(90)
  expect(screen.getByTestId('pu-period-90').getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByTestId('pi-updated').textContent).toMatch(/^Updated /)
  fireEvent.click(screen.getByTestId('pu-plan'))
  expect(onOpenPlanner).toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('pu-view-top'))
  expect(screen.getByTestId('pi-view-split').getAttribute('aria-pressed')).toBe('true')
})
