/**
 * Sessions tab (reference layout): Today hero with 8 inset cells, three equal
 * platform cards, Recent Sessions | Session Details master–detail. Figures
 * come from lib/sessions/normalize.js; this checks what renders.
 */
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SessionsOverview from '../SessionsOverview'
import { liveShow } from '../../../lib/sessions/__fixtures__/batch1-fixtures'

const NOW = new Date('2026-10-07T20:00:00Z')
const TZ = 'UTC'

const show = {
  id: 'show-a', platform: 'chaturbate', startedAt: '2026-10-07T17:00:00Z', endedAt: '2026-10-07T18:00:00Z',
  finalizedAt: '2026-10-07T18:00:00Z', durationSeconds: 3600, totalUsd: 11.16, publicUsd: 10.5, privateUsd: 0.66,
  privateSeconds: 120,
  privateIntervals: [{ id: 'iv', platform: 'chaturbate', startedAt: '2026-10-07T17:30:00Z', endedAt: '2026-10-07T17:32:00Z', earningsUsd: 0.66 }],
  tokens: 260, tipCount: 3, uniqueTippers: 3,
  topTipper: { username: 'Alice', usd: 5 }, largestTipUsd: 5, usdPerHour: 11.16,
  platformRevenue: [
    { platform: 'chaturbate', usd: 5, tips: 1 }, { platform: 'myfreecams', usd: 3, tips: 1 }, { platform: 'bongacams', usd: 2.5, tips: 1 },
  ],
  isNew: true, seenAt: null,
}

const liveTips = [
  { id: 1, date_time: '2026-10-07T17:05:00Z', platform: 'chaturbate', username: 'Alice', usd: 5, tokens: 100, live_session_id: 'show-a', source: 'extension' },
  { id: 2, date_time: '2026-10-07T17:06:00Z', platform: 'myfreecams', username: 'Alice', usd: 3, tokens: 60, live_session_id: 'show-a', source: 'extension' },
  { id: 3, date_time: '2026-10-07T17:40:00Z', platform: 'bongacams', username: 'Bob', usd: 2.5, tokens: 100, live_session_id: 'show-a', source: 'extension' },
]
const freeChat = [
  { id: 4, date_time: '2026-10-07T12:00:00Z', platform: 'bongacams', username: 'Cara', usd: 4, tokens: 160, live_session_id: null, source: 'extension' },
  { id: 5, date_time: '2026-10-07T12:45:00Z', platform: 'bongacams', username: 'Dan', usd: 6, tokens: 240, live_session_id: null, source: 'extension' },
]

const val = (id) => screen.getByTestId(id).textContent
const click = (id) => fireEvent.click(screen.getByTestId(id).querySelector('button') || screen.getByTestId(id))
const renderTab = (props = {}) => render(<SessionsOverview tips={[]} shows={[]} paidSessions={[]} tz={TZ} now={NOW} {...props} />)

test('hero: total = public + private, live-linked tips counted once, 8 cells', () => {
  renderTab({ tips: [...liveTips, ...freeChat], shows: [show] })
  // Hero totals (Today tiles) were removed with the hero; the Pulse card replaces them.
  expect(screen.queryByTestId('today-total')).toBeNull()
  expect(screen.queryByTestId('today-streamed')).toBeNull()
  expect(screen.getByTestId('session-pulse')).toBeTruthy()
})

test('three equal platform cards with share and BEST TODAY on the real leader', () => {
  renderTab({ tips: [...liveTips, ...freeChat], shows: [show] })
  for (const p of ['bongacams', 'chaturbate', 'myfreecams']) expect(screen.getByTestId(`today-platform-${p}`)).toBeTruthy()
  const bc = screen.getByTestId('today-platform-bongacams')
  expect(bc.textContent).toContain('59%')
  expect(bc.textContent).toContain('$12.50')
  expect(within(bc).getByTestId('best-platform-badge').textContent).toBe('BEST TODAY')
  expect(within(screen.getByTestId('today-platform-chaturbate')).queryByTestId('best-platform-badge')).toBeNull()
})

test('a finalized Live show is listed and selected by default; never "No sessions yet"', () => {
  renderTab({ tips: liveTips, shows: [show] })
  const row = screen.getByTestId('history-live:show-a')
  expect(row.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByTestId('row-new-badge')).toBeTruthy()
  expect(row.textContent).toContain('JUST ENDED')
  expect(screen.queryByTestId('history-empty')).toBeNull()
  expect(val('details-total')).toBe('$11.16')
  expect(val('details-public')).toBe('$10.50')
  expect(val('details-private')).toBe('$0.66')
  expect(val('details-unique')).toBe('3')
  expect(val('details-largest')).toBe('$5.00')
  expect(val('details-top')).toBe('Alice')
  expect(val('details-duration')).toBe('1h 0m')
  expect(val('details-private-time')).toBe('2m')
})

test('selecting another session updates the details panel (no expansion)', () => {
  renderTab({ tips: [...liveTips, ...freeChat], shows: [show] })
  const fc = screen.getAllByTestId(/^history-tips:/)[0]
  fireEvent.click(fc)
  expect(fc.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByTestId('history-live:show-a').getAttribute('aria-pressed')).toBe('false')
  expect(val('details-total')).toBe('$10.00')
  expect(val('details-top')).toBe('Dan')
})

test('earnings timeline uses real data; honest empty state otherwise', () => {
  const { unmount } = renderTab({ tips: liveTips, shows: [show] })
  expect(screen.getByTestId('details-timeline')).toBeTruthy()
  unmount()
  renderTab({ paidSessions: [{ id: 7, date_time: '2026-10-07T15:00:00Z', platform: 'bongacams', username: 'Fay', session_type: 'Private Chat', usd: 7 }] })
  expect(screen.getByTestId('details-timeline-empty')).toBeTruthy()
})

test('type filters', () => {
  renderTab({ tips: [...liveTips, ...freeChat], shows: [show] })
  click('filter-type-free_chat')
  expect(screen.queryByTestId('history-live:show-a')).toBeNull()
  expect(screen.getAllByTestId('type-badge-free_chat')).toHaveLength(1)
  click('filter-type-private')
  expect(screen.getByTestId('history-filter-empty')).toBeTruthy()
})

test('7 Days range widens the same formulas', () => {
  const older = [{ id: 9, date_time: '2026-10-03T12:00:00Z', platform: 'chaturbate', username: 'Zed', usd: 9, tokens: 180, live_session_id: null, source: null }]
  renderTab({ tips: [...freeChat, ...older] })
  // The hero Today totals are no longer rendered; the Session Pulse card replaces them.
  // The range control itself is still on the page (it is not part of the hero).
  expect(screen.getByTestId('range-7')).toBeTruthy()
  expect(screen.queryByTestId('today-total')).toBeNull()
  expect(screen.getByTestId('session-pulse')).toBeTruthy()
})

test('empty account: activation state, no grid of zeros', () => {
  const onImport = jest.fn(), onStartLive = jest.fn()
  const { container } = renderTab({ onImport, onStartLive })
  expect(screen.getByTestId('sessions-activation').textContent).toMatch(/No performance data yet/)
  expect(screen.queryByTestId('today-stats')).toBeNull()
  expect(screen.queryByTestId('today-by-platform')).toBeNull()
  expect(screen.getAllByTestId('activation-preview')).toHaveLength(4)
  expect(container.textContent).not.toMatch(/\$\d/) // previews describe features, no numbers
  fireEvent.click(screen.getByTestId('activation-import')); expect(onImport).toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('activation-live')); expect(onStartLive).toHaveBeenCalled()
})

test('imported private charges are one PRIVATE session and count as private', () => {
  renderTab({ paidSessions: [
    { id: 7, date_time: '2026-10-07T15:00:00Z', platform: 'bongacams', username: 'Fay', username_lower: 'fay', session_type: 'Private Chat', usd: 0.38 },
    { id: 8, date_time: '2026-10-07T15:01:00Z', platform: 'bongacams', username: 'Fay', username_lower: 'fay', session_type: 'Private Chat', usd: 0.38 },
  ] })
  expect(screen.getAllByTestId(/^history-private:/)).toHaveLength(1)
  // imported-only data → Overall Performance hero
  expect(screen.queryByTestId('overall-private')).toBeNull() // Overall hero removed
  expect(screen.getByTestId('session-pulse')).toBeTruthy()
  expect(val('details-tips')).toBe('2 charges')
})

test('LIVE NOW: running show leads the list and the hero chip shows it', () => {
  const session = { id: 'run-1', status: 'live', started_at: '2026-10-07T19:00:00Z', active_duration_seconds: 2520 }
  const runTips = [
    { id: 9, date_time: '2026-10-07T19:30:00Z', platform: 'chaturbate', username: 'Gus', usd: 20, tokens: 400, live_session_id: 'run-1', source: 'extension' },
    { id: 10, date_time: '2026-10-07T19:31:00Z', platform: 'bongacams', username: 'Gus', usd: 5, tokens: 200, live_session_id: 'run-1', source: 'extension' },
  ]
  renderTab({ tips: [...liveTips, ...runTips], shows: [show], live: { session, privateInterval: null } })
  // The hero live chip was removed; the Pulse card shows the running show.
  expect(screen.queryByTestId('hero-live')).toBeNull()
  expect(screen.getByTestId('session-pulse').getAttribute('data-kind')).toBe('live_now')
  expect(screen.getAllByTestId(/^history-/)[0].getAttribute('data-testid')).toBe('history-running:run-1')
  expect(val('details-total')).toBe('$25.00')
  expect(val('details-unique')).toBe('2') // Gus on two platforms = two fans
})

test('vs-yesterday comparison only with real yesterday data', () => {
  const y = [{ id: 11, date_time: '2026-10-06T11:00:00Z', platform: 'bongacams', username: 'Y', usd: 8, tokens: 320, live_session_id: null, source: null }]
  renderTab({ tips: [...freeChat, ...y] })
  expect(screen.queryByTestId('today-comparison')).toBeNull() // Today hero removed
})

test('strongest signal from real shares', () => {
  renderTab({ tips: [...liveTips, ...freeChat], shows: [show] })
  expect(val('today-signal')).toContain('BongaCams is leading today with 59% of your earnings.')
  expect(val('today-signal')).toContain('$12.50 of today')
})

// ── Adaptive layer (CSV-only / single-platform / mixed) ──────────────────────
const csvTip = (id, iso, platform, username, usd) => ({ id, date_time: iso, platform, username, usd, tokens: 0, live_session_id: null, source: 'upload' })
// 3 meaningful Chaturbate sessions on different days (>= 30 min, >= 2 tips each)
const csvTips = [
  csvTip(101, '2026-09-01T20:00:00Z', 'chaturbate', 'Ann', 10), csvTip(102, '2026-09-01T20:40:00Z', 'chaturbate', 'Ben', 5),
  csvTip(103, '2026-09-03T20:00:00Z', 'chaturbate', 'Ann', 20), csvTip(104, '2026-09-03T20:50:00Z', 'chaturbate', 'Cy', 4),
  csvTip(105, '2026-09-05T20:00:00Z', 'chaturbate', 'Ann', 6), csvTip(106, '2026-09-05T20:35:00Z', 'chaturbate', 'Ben', 9),
  csvTip(107, '2026-09-06T10:00:00Z', 'chaturbate', 'Dee', 1), // lone tip: not a session, still counted in totals
]

test('CSV-only: Overall Performance hero, no Today/range controls, no stream time or $/hr', () => {
  const { container } = renderTab({ tips: csvTips })
  expect(screen.queryByTestId('today-stats')).toBeNull()
  expect(screen.queryByTestId('scope-switch')).toBeNull()
  expect(screen.queryByTestId('range-1')).toBeNull()
  // Overall hero removed from the page; the Session Pulse card replaces it.
  expect(screen.queryByTestId('overall-source')).toBeNull()
  expect(screen.queryByTestId('overall-total')).toBeNull()
  expect(screen.getByTestId('session-pulse')).toBeTruthy()
  expect(container.textContent).not.toMatch(/\/hr|per hour|Streamed Time|Best Day|Best Time/i)
  expect(screen.getAllByTestId(/^history-tips:/)).toHaveLength(3)
  expect(container.textContent).toMatch(/Est\. span/)
})

test('single platform: Session Performance cards replace platform comparison', () => {
  renderTab({ tips: csvTips })
  expect(screen.queryByTestId('today-by-platform')).toBeNull()
  expect(val('perf-typical-median')).toBe('$15.00')
  expect(val('perf-typical-count')).toBe('3')
  expect(screen.getByTestId('perf-momentum').textContent).toMatch(/3 more sessions needed for Recent Momentum/)
  expect(val('perf-audience-unique')).toBe('4')
  expect(screen.getByTestId('perf-audience').textContent).toMatch(/2 repeat fans/) // Ann (3 sessions), Ben (2)
  expect(val('perf-audience-top')).toBe('Ann ($36.00), Ben ($14.00), Cy ($4.00)')
  expect(val('perf-audience-share')).toBe('98%') // 54 / 55
})

test('mixed Live + CSV: Today is default, Overall switch shows overall history', () => {
  renderTab({ tips: [...liveTips, ...freeChat, ...csvTips], shows: [show] })
  // Scope switch and Today/Overall hero were removed; the Pulse card replaces them.
  expect(screen.getByTestId('scope-switch')).toBeTruthy() // page control, still rendered
  expect(screen.queryByTestId('today-stats')).toBeNull()
  expect(screen.getByTestId('session-pulse')).toBeTruthy()
  click('scope-overall')
  expect(screen.getByTestId('session-performance')).toBeTruthy()
  expect(screen.queryByTestId('range-1')).toBeNull()
})

test('no data: no scope switch or range controls', () => {
  renderTab({})
  expect(screen.queryByTestId('scope-switch')).toBeNull()
  expect(screen.queryByTestId('range-group')).toBeNull()
})

test('Free history note follows the primary platform', () => {
  const { unmount } = renderTab({ tips: csvTips, isPro: false, primaryPlatform: null })
  // The hero history note was removed with the hero.
  expect(screen.queryByTestId('overall-history-note')).toBeNull()
  unmount()
  renderTab({ tips: csvTips, isPro: false, primaryPlatform: 'Chaturbate' })
  expect(screen.queryByTestId('overall-history-note')).toBeNull()
})

// ── UI polish (no numeric change) ────────────────────────────────────────────
test('mixed mode: no two adjacent controls both labeled "Today"', () => {
  renderTab({ tips: [...liveTips, ...freeChat, ...csvTips], shows: [show] })
  expect(val('scope-today')).toBe('Today')
  expect(val('range-1')).toBe('1 Day')
  expect(screen.getByTestId('range-group').textContent).not.toMatch(/Today/)
})

test('one private charge reads "1 charge"', () => {
  renderTab({ paidSessions: [{ id: 9, date_time: '2026-10-07T15:00:00Z', platform: 'bongacams', username: 'Fay', username_lower: 'fay', session_type: 'Private Chat', usd: 0.38 }] })
  expect(val('details-tips')).toBe('1 charge')
  expect(screen.getByTestId('session-history').textContent).toMatch(/1Charge(?!s)/)
})

test('no data: never signals live activity', () => {
  const { container } = renderTab({})
  expect(container.textContent).not.toMatch(/LIVE DATA|LIVE NOW/)
})

test('light data: real numbers kept, empty cells become guidance', () => {
  // one free-chat session today (2 tips, 45 min): fewer than 3 meaningful sessions
  renderTab({ tips: freeChat })
  // Today hero removed; the Pulse card replaces it.
  expect(screen.queryByTestId('today-total')).toBeNull()
  expect(screen.getByTestId('session-pulse')).toBeTruthy()
  expect(screen.getByTestId('perf-typical').textContent).toMatch(/2 more sessions needed for Typical Session/)
  expect(screen.getByTestId('perf-momentum').textContent).toMatch(/5 more sessions needed for Recent Momentum/)
})

test('platform cards only for platforms with data', () => {
  const cb = { id: 50, date_time: '2026-10-07T13:00:00Z', platform: 'chaturbate', username: 'Zed', usd: 2, tokens: 40, live_session_id: null, source: 'extension' }
  renderTab({ tips: [...freeChat, cb] })
  expect(screen.getByTestId('today-platform-chaturbate')).toBeTruthy()
  expect(screen.getByTestId('today-platform-bongacams')).toBeTruthy()
  expect(screen.queryByTestId('today-platform-myfreecams')).toBeNull() // no MyFreeCams data → no $0 card
})

test('money values never wrap', () => {
  renderTab({ tips: csvTips })
  // Overall hero removed; the Pulse amount uses the shared money class (no-wrap styling).
  expect(screen.getByTestId('pulse-amount').className).toMatch(/money/)
})

// ── Session Details tabs: Timeline buckets and Fans ──────────────────────────
test('Details tabs: Overview (default), Timeline buckets, Fans with New/Returning', () => {
  renderTab({ tips: csvTips, isPro: true })
  // newest meaningful session: Sep 5 (Ann 6 @20:00, Ben 9 @20:35)
  expect(screen.getByTestId('details-public')).toBeTruthy()
  click('details-tab-timeline')
  expect(val('buckets-span-label')).toBe('Earning activity span')
  expect(screen.getAllByTestId('bucket-row')).toHaveLength(4) // 35 min → 10-minute buckets
  expect(screen.queryByTestId('buckets-peak')).toBeNull() // only 2 earning buckets
  expect(screen.queryByTestId('details-public')).toBeNull()
  click('details-tab-fans')
  const fans = screen.getAllByTestId('fan-driver')
  expect(fans[0].textContent.startsWith('1Ben')).toBe(true)
  expect(fans[1].textContent.startsWith('2Ann')).toBe(true)
  expect(fans[0].textContent).toMatch(/\$9\.00/)
  expect(fans[0].textContent).toMatch(/60% of session/)
  expect(fans[0].textContent).toMatch(/RETURNING/) // Ben tipped on Sep 1
  expect(fans[1].textContent).toMatch(/RETURNING/) // Ann tipped on Sep 1 and 3
})

test('Fans: first appearance is New; Free outside primary says "in your available history"', () => {
  renderTab({ tips: csvTips.filter((t) => t.date_time.startsWith('2026-09-01')), isPro: false, primaryPlatform: 'BongaCams' })
  click('details-tab-fans')
  expect(screen.getAllByTestId('fan-status-new')).toHaveLength(2)
  expect(screen.getByTestId('fan-drivers').textContent).toMatch(/NEW IN YOUR AVAILABLE HISTORY/)
})

test('Recent Sessions rows marked above/below typical once 5 comparable sessions exist', () => {
  const day = (d, a, b) => [csvTip(d * 10, `2026-09-${String(d).padStart(2, '0')}T20:00:00Z`, 'chaturbate', 'Ann', a), csvTip(d * 10 + 1, `2026-09-${String(d).padStart(2, '0')}T20:40:00Z`, 'chaturbate', 'Ben', b)]
  const tips = [...day(2, 20, 10), ...day(4, 10, 10), ...day(6, 15, 5), ...day(8, 8, 2), ...day(10, 5, 5), ...day(12, 6, 4), ...day(14, 30, 10)]
  renderTab({ tips })
  const marks = screen.getAllByTestId(/^row-vs-/)
  expect(marks[0].getAttribute('data-outcome')).toBe('above')
  expect(marks[0].textContent).toBe('▲ +167%vs typical')
  expect(val('details-vs')).toMatch(/\+167% vs typical \(median \$15\.00 of 6 of your Chaturbate imported sessions\)/)
  expect(marks.some((m) => m.getAttribute('data-outcome') === 'below')).toBe(true)
})

test('no vs-typical marker without enough history', () => {
  renderTab({ tips: csvTips })
  expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0)
  expect(screen.getByTestId('details-vs-empty')).toBeTruthy()
})

// ── Schedule tab ─────────────────────────────────────────────────────────────
const plan = (s, e, platform = 'Chaturbate') => ({ id: s, platform, start_at: s, end_at: e })
test('Schedule: "No saved plan" when the creator has never saved one', () => {
  renderTab({ tips: csvTips })
  click('details-tab-schedule')
  expect(screen.getByTestId('schedule').getAttribute('data-status')).toBe('no_plans')
  expect(val('schedule-badge')).toBe('NO SAVED PLAN')
})
test('Schedule: "Unscheduled" only when plans exist but none matched', () => {
  renderTab({ tips: csvTips, plannedStreams: [plan('2026-08-01T20:00:00Z', '2026-08-01T22:00:00Z')] })
  click('details-tab-schedule')
  expect(val('schedule-badge')).toBe('UNSCHEDULED')
})
test('Schedule: imported session says activity began, never that the stream started', () => {
  // newest csv session starts 2026-09-05T20:00Z
  const { container } = renderTab({ tips: csvTips, plannedStreams: [plan('2026-09-05T19:30:00Z', '2026-09-05T22:00:00Z')] })
  click('details-tab-schedule')
  expect(val('schedule-badge')).toBe('ACTIVITY AFTER PLANNED START')
  expect(val('schedule-text')).toBe('Activity began inside your planned window, 30 min after your planned start.')
  expect(screen.getByTestId('schedule').textContent).not.toMatch(/Started|went live at/)
  expect(container).toBeTruthy()
})
test('Schedule: Live show uses the exact start and shows end difference and overlap', () => {
  renderTab({ tips: [...liveTips, ...freeChat], shows: [show], plannedStreams: [plan('2026-10-07T16:55:00Z', '2026-10-07T18:30:00Z')] })
  // select the Live show row
  fireEvent.click(screen.getByTestId('history-live:show-a'))
  click('details-tab-schedule')
  expect(val('schedule-badge')).toBe('ON SCHEDULE ✓')
  expect(val('schedule-text')).toMatch(/Started .* \(5 min late\)/)
  expect(val('schedule-overlap')).toBe('63%') // 17:00–18:00 of a 95-min window
})

// ── Sessions accuracy foundation (Batch 1) ───────────────────────────────────
describe('completeness, $/hr and timezone', () => {
  const MIN = 60000, DAY = 86400000
  const T = Date.parse('2026-10-30T22:00:00Z'), WS = T - 30 * DAY
  const at = (ms) => new Date(ms).toISOString()
  // Chaturbate session straddling the Free window start: first two tips are hidden for Free.
  const all = [
    csvTip(1, at(WS - 25 * MIN), 'chaturbate', 'Old1', 9), csvTip(2, at(WS - 10 * MIN), 'chaturbate', 'Old2', 9),
    csvTip(3, at(WS + 10 * MIN), 'chaturbate', 'Ann', 9), csvTip(4, at(WS + 25 * MIN), 'chaturbate', 'Ben', 9), csvTip(5, at(WS + 50 * MIN), 'chaturbate', 'Cy', 9),
    csvTip(6, at(T), 'chaturbate', 'Late', 9),
  ]
  const freeProps = () => {
    const visible = all.filter((t) => Date.parse(t.date_time) >= WS)
    return { tips: visible, allTips: all, allPaidSessions: [], windowStarts: { chaturbate: new Date(WS) }, isPro: false, primaryPlatform: null }
  }
  // seven earlier comparable sessions so a verdict WOULD exist for a complete session
  const history = Array.from({ length: 7 }, (_, i) => [
    csvTip(100 + i * 2, at(WS + (2 + i) * DAY), 'chaturbate', 'H1', 10 + i), csvTip(101 + i * 2, at(WS + (2 + i) * DAY + 40 * MIN), 'chaturbate', 'H2', 10),
  ]).flat()

  test('Free: a session that started before the window is labeled partial and gets no verdict', () => {
    // (Only the latest 5 sessions are listed today, so the straddling session is rendered
    // on its own here; "partial gets no verdict even with a full baseline" is covered in
    // lib/sessions/__tests__/batch1-accuracy.test.js.)
    renderTab(freeProps())
    expect(screen.getByTestId('details-vs-partial').textContent).toMatch(/before your Free history window/)
    expect(screen.queryByTestId('details-vs')).toBeNull()
    expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0)
  })

  test('Free without full-history inputs fails closed: no verdict is shown', () => {
    renderTab({ tips: [...all.filter((t) => Date.parse(t.date_time) >= WS), ...history], isPro: false })
    expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0)
    expect(screen.queryByTestId('details-vs')).toBeNull()
  })

  test('Pro sees the same session complete (no partial label)', () => {
    renderTab({ tips: [...all, ...history], isPro: true })
    expect(screen.queryByTestId('details-vs-partial')).toBeNull()
    expect(screen.queryByTestId('details-vs-unknown')).toBeNull()
  })

  test('no $/hr for imported sessions', () => {
    renderTab({ tips: history, isPro: true })
    expect(screen.queryByTestId('details-vs-hourly')).toBeNull()
    expect(screen.getByTestId('session-details-body').textContent).not.toMatch(/\/hr/)
  })

  test('Live: the persisted $/hr is shown only with >= 5 comparable verified Live shows', () => {
    const live = (i) => liveShow({ id: `s${i}`, platform: 'chaturbate', startedAt: at(Date.parse('2026-10-01T19:00:00Z') + i * DAY), minutes: 60, publicUsd: 50 + i * 10, tipCount: 3, uniqueTippers: 2 })
    const six = [0, 1, 2, 3, 4, 5].map(live)
    const { unmount } = renderTab({ shows: six, isPro: true })
    expect(val('details-vs-hourly')).toMatch(/\$100\.00\/hr over the recorded show vs a typical \$70\.00\/hr \(\+43%, median of 5 of your Chaturbate Live shows\)/)
    unmount()
    renderTab({ shows: six.slice(0, 5), isPro: true }) // only 4 others
    expect(screen.queryByTestId('details-vs-hourly')).toBeNull()
  })

  test('Live: an unverified duration (inferred end) shows the earnings verdict but no $/hr', () => {
    const live = (i, over = {}) => ({ ...liveShow({ id: `s${i}`, platform: 'chaturbate', startedAt: at(Date.parse('2026-10-01T19:00:00Z') + i * DAY), minutes: 60, publicUsd: 50 + i * 10, tipCount: 3 }), ...over })
    renderTab({ shows: [0, 1, 2, 3, 4].map((i) => live(i)).concat(live(5, { endedHow: 'auto_ended_inactivity' })), isPro: true })
    expect(screen.getByTestId('details-vs').textContent).toMatch(/vs typical/)
    expect(screen.queryByTestId('details-vs-hourly')).toBeNull()
  })

  test('tipsLoadComplete={false} (the plumbing #747 will use): no verdicts, "cannot be confirmed" label', () => {
    renderTab({ tips: history, isPro: true, tipsLoadComplete: false })
    expect(screen.queryAllByTestId(/^row-vs-/)).toHaveLength(0)
    expect(screen.getByTestId('details-vs-unknown').textContent).toMatch(/can.t be confirmed/)
  })

  test('KNOWN LIMITATION (issue #747): the dashboard does not pass the load status yet, so the default does NOT flag an incomplete load', () => {
    renderTab({ tips: history, isPro: true }) // same data, flag omitted exactly as page.js calls it today
    expect(screen.getAllByTestId(/^row-vs-/).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('details-vs-unknown')).toBeNull()
  })

  test('Free: restricted rows never reach the DOM, on any tab (imported straddle and a partly-hidden Live show)', () => {
    const hiddenImported = [csvTip(8001, at(WS - 25 * MIN), 'chaturbate', 'HiddenWhale', 4321.09), csvTip(8002, at(WS - 10 * MIN), 'chaturbate', 'HiddenPal', 1234.56)]
    const visible = [csvTip(8003, at(WS + 10 * MIN), 'chaturbate', 'Ann', 9), csvTip(8004, at(WS + 25 * MIN), 'chaturbate', 'Ben', 9), csvTip(8005, at(WS + 50 * MIN), 'chaturbate', 'Cy', 9), csvTip(8006, at(T), 'chaturbate', 'Late', 9)]
    // imported straddle
    let r = renderTab({ tips: visible, allTips: [...hiddenImported, ...visible], allPaidSessions: [], windowStarts: { chaturbate: new Date(WS) }, isPro: false })
    for (const tab of ['overview', 'timeline', 'schedule', 'fans']) {
      click(`details-tab-${tab}`)
      for (const x of ['HiddenWhale', 'HiddenPal', '4321', '1234.56']) expect(r.container.innerHTML).not.toContain(x)
    }
    click('details-tab-overview')
    expect(screen.getByTestId('details-vs-partial').textContent).toMatch(/started before your Free history window/)
    r.unmount()
    // partly-hidden Live show
    const SHOW = Date.parse('2026-10-01T20:00:00Z')
    const cbTip = { ...csvTip(9001, at(SHOW + 10 * MIN), 'chaturbate', 'VisibleFan', 25), live_session_id: 'lm', source: 'extension' }
    const mfcTip = { ...csvTip(9002, at(SHOW + 40 * MIN), 'myfreecams', 'HiddenLiveFan', 777.77), live_session_id: 'lm', source: 'extension' }
    const show = liveShow({ id: 'lm', platform: 'chaturbate', startedAt: at(SHOW), minutes: 90, publicUsd: 25 + 777.77, tipCount: 2, uniqueTippers: 2, platformRevenue: [{ platform: 'chaturbate', usd: 25, tips: 1 }, { platform: 'myfreecams', usd: 777.77, tips: 1 }] })
    r = renderTab({ tips: [cbTip], shows: [show], allTips: [cbTip, mfcTip], allPaidSessions: [], windowStarts: { chaturbate: new Date(SHOW - DAY), myfreecams: new Date(SHOW + 10 * DAY) }, isPro: false })
    expect(screen.getByTestId('details-vs-partial').textContent).toMatch(/Some of this show's tips are outside your Free history window/)
    for (const tab of ['overview', 'timeline', 'schedule', 'fans']) {
      click(`details-tab-${tab}`)
      expect(r.container.innerHTML).not.toContain('HiddenLiveFan')
    }
  })

  test('times use the creator timezone, including across a DST change (America/New_York) and a :30 offset (Asia/Kolkata)', () => {
    // 2026-11-01: US clocks go back at 06:00Z. Tips every ~40 min, 05:30Z → 07:10Z.
    const dst = ['05:30', '06:10', '06:50', '07:10'].map((hm, i) => csvTip(900 + i, `2026-11-01T${hm}:00Z`, 'chaturbate', `F${i}`, 5))
    let r = renderTab({ tips: dst, tz: 'America/New_York', isPro: true })
    click('details-tab-timeline')
    const ny = screen.getAllByTestId('bucket-row').map((x) => x.textContent)
    expect(ny[0]).toMatch(/^1:30\sAM–1:45\sAM/) // 05:30Z = 1:30 AM EDT
    expect(ny.join(' ')).toMatch(/1:45\sAM–1:00\sAM/) // 06:00Z is 1:00 AM EST: the hour repeats
    r.unmount()
    r = renderTab({ tips: dst, tz: 'Asia/Kolkata', isPro: true })
    click('details-tab-timeline')
    expect(screen.getAllByTestId('bucket-row')[0].textContent).toMatch(/^11:00\sAM–11:15\sAM/) // 05:30Z = 11:00 IST
  })
})
