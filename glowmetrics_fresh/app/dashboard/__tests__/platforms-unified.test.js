/**
 * Platforms — Unified view (mockup layout). Every figure must be the canonical
 * engine output (aggregateRows → lib/platformIntelligenceAnalytics builders);
 * the view only selects and formats. Free/Pro gating must match the previous view.
 */
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PlatformsIntelligence from '../PlatformsIntelligence'
import { aggregateRows, applyFreeAnalysisWindow } from '../../../lib/analytics'
import { buildBusinessSnapshot, buildPlatformComparison } from '../../../lib/platformIntelligenceAnalytics'
import { buildAccount } from './dashboardFixtures'

const NOW = Date.parse('2026-11-10T22:00:00Z')
const TZ = 'America/New_York'
const account = buildAccount({ now: NOW, plan: 'pro' })
const proTips = account.tables.tips
const freeTips = applyFreeAnalysisWindow(proTips, { windowDays: 31, unlimitedPlatform: 'Chaturbate' })
const proA = aggregateRows(proTips, TZ)
const freeA = aggregateRows(freeTips, TZ)
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const renderPage = (props = {}) => render(<PlatformsIntelligence analytics={proA} tips={proTips} isPro onOpenPlanner={() => {}} {...props} />)

test('KPI total is the engine snapshot total, and platform cards reconcile to it', () => {
  renderPage()
  const snap = buildBusinessSnapshot(proA)
  const rows = buildPlatformComparison(proA)
  expect(screen.getByTestId('pu-total').textContent).toBe(money(snap.totalEarnings))
  const sum = rows.slice(0, 3).reduce((s, p) => s + p.earnings, 0)
  if (rows.length <= 3) expect(Math.round(sum * 100) / 100).toBe(snap.totalEarnings)
  for (const p of rows.slice(0, 3)) {
    const card = screen.getByTestId(`pu-card-${p.platform}`)
    expect(card.textContent).toContain(money(p.earnings))
    expect(card.textContent).toContain(`${p.earningsPercent}% of total`)
  }
  expect(screen.getByTestId('pu-top').textContent).toBe(rows[0].platform)
})

test('$/hr appears only from the engine rate (duration-qualified), never invented', () => {
  renderPage()
  for (const p of buildPlatformComparison(proA).slice(0, 3)) {
    const card = screen.getByTestId(`pu-card-${p.platform}`)
    if (p.rateHours > 0 && p.usdPerHour > 0) expect(card.textContent).toContain(`${money(p.usdPerHour)}/hr`)
    else expect(card.textContent).toContain('—/hr')
  }
  const snap = buildBusinessSnapshot(proA)
  expect(screen.getByTestId('pu-hourly').textContent).toBe(snap.usdPerHour === null ? '—' : money(snap.usdPerHour))
})

test('the 30-day change is labelled as last 30 days vs prior 30 (not vs the total)', () => {
  const { container } = renderPage()
  if (proA.momentum && proA.momentum.pct !== null) expect(container.textContent).toMatch(/last 30 days vs prior 30/)
  expect(container.textContent).not.toMatch(/prior 90/)
})

test('Free: per-platform timing stays Pro-locked; Pro sees it', () => {
  const { unmount } = render(<PlatformsIntelligence analytics={freeA} tips={freeTips} isPro={false} />)
  const timing = screen.getByLabelText('Timing opportunities')
  if (!/three separate days/.test(timing.textContent)) {
    expect(timing.textContent).toMatch(/Best hour and day per platform/)
    expect(timing.textContent).toMatch(/PRO/)
  }
  unmount()
  renderPage()
  expect(within(screen.getByLabelText('Timing opportunities')).queryByText(/Best hour and day per platform/)).toBeNull()
})

test('clicking a platform card opens it in the existing Split view', () => {
  renderPage()
  const first = buildPlatformComparison(proA)[0].platform
  fireEvent.click(screen.getByTestId(`pu-card-${first}`))
  expect(screen.getByTestId('pi-view-split').getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByTestId('platforms-unified')).toBeNull()
})

test('Go Live uses the provided handler and is hidden without one', () => {
  const onGoLive = jest.fn()
  const { unmount } = renderPage({ onGoLive })
  fireEvent.click(screen.getByTestId('pi-go-live'))
  expect(onGoLive).toHaveBeenCalled()
  unmount()
  renderPage()
  expect(screen.queryByTestId('pi-go-live')).toBeNull()
})

test('the previous detailed tables stay available in a collapsed Full breakdown', () => {
  renderPage()
  const toggle = screen.getByTestId('pi-breakdown-toggle')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByTestId('pi-breakdown')).toBeNull()
  fireEvent.click(toggle)
  const body = screen.getByTestId('pi-breakdown')
  for (const t of ['Your cam business', 'Where your money comes from', 'Who is driving your revenue', 'Your next best move']) expect(body.textContent).toContain(t)
})

test('no data: honest empty state, no new view', () => {
  render(<PlatformsIntelligence analytics={null} tips={[]} />)
  expect(screen.queryByTestId('platforms-unified')).toBeNull()
  expect(screen.getByText(/No platform has enough session data/)).toBeTruthy()
})
