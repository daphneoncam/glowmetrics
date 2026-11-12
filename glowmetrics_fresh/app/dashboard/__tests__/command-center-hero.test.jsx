/**
 * "Your next best move" hero + Stream Planner read the shared best-time
 * formula (lib/analytics.js calculateBestTimeWindows):
 *  - the hero shows TODAY's best qualifying platform and 1-hour window, with
 *    real valid-session / separate-date counts and calculateConfidence labels,
 *    plus a link to the full plan;
 *  - when today has no qualifying window it says "Not enough data yet" and does
 *    NOT recommend another weekday's window as today's move;
 *  - the Stream Planner uses the same windows (no parallel formula).
 */
const fs = require('fs')
const path = require('path')
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import CommandCenter from '../CommandCenter'
import StreamPlanner from '../StreamPlanner'
import { calculateBestTimeWindows, aggregateRows } from '../../../lib/analytics'

const TZ = 'America/Los_Angeles'
// A Saturday in Los Angeles (and in UTC).
const SATURDAY_NOON = '2026-10-31T19:00:00Z'
const cell = (over = {}) => ({
  platform: 'BongaCams', day: 'Saturday', dayIndex: 6, hour: 14,
  totalUSD: 30, streamedMinutes: 240, streamedHours: 4, usdPerStreamedHour: 7.5,
  validSessionCount: 4, localDates: 4, eligible: true,
  confidence: { level: 'Low', label: 'Early signal' }, durationBasis: 'tip_span_estimate',
  fanOverlap: { count: 0, totalUSD: 0 },
  ...over,
})
// byDay values: a cell, an array of cells (best first), or null. Mirrors the engine:
// recommendedByDay[day] = recommended cells best first; bestByDay[day] = first.
const baseAnalytics = (byDay) => {
  const recommendedByDay = {}, bestByDay = {}
  Object.entries(byDay).forEach(([d, v]) => { const list = v ? (Array.isArray(v) ? v : [v]) : []; recommendedByDay[d] = list; bestByDay[d] = list[0] || null })
  return baseWith(recommendedByDay, bestByDay)
}
const baseWith = (recommendedByDay, bestByDay) => ({
  bestTimeWindows: { minLocalDates: 3, recommendedByDay, bestByDay, overall: { validSessionCount: 4, streamedHours: 4, confidence: { level: 'Low', label: 'Early signal' } } },
  totalUSD: 100, uniqueFanCount: 10, meaningfulSessionCount: 4, totalStreamMinutes: 240, estimatedHourlyRate: 7.5,
  platforms: [], whales: [], momentum: null,
})
const renderHero = (analytics, props = {}) =>
  render(<CommandCenter tz={TZ} analytics={analytics} isPro={false} onPlanStream={jest.fn()} {...props} />)

beforeEach(() => jest.useFakeTimers({ now: new Date(SATURDAY_NOON), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick'] }))
afterEach(() => jest.useRealTimers())

describe('hero: today\'s best platform and 1-hour window', () => {
  test("shows today's platform and the exact measured hour — never an 8-hour or 2-hour span", () => {
    renderHero(baseAnalytics({ Saturday: cell(), Wednesday: cell({ day: 'Wednesday', dayIndex: 3, hour: 9, usdPerStreamedHour: 20 }) }))
    const h = screen.getByTestId('hero-headline')
    expect(h).toHaveTextContent('Go live today 2:00 PM – 3:00 PM on BongaCams')
    expect(h).not.toHaveTextContent('10:00 PM')
    expect(h).not.toHaveTextContent('Wednesday')
  })

  test('sample is real valid sessions and separate days, with the canonical confidence label (not "qualifying sessions", not "Pattern")', () => {
    renderHero(baseAnalytics({ Saturday: cell() }))
    const sample = screen.getByTestId('hero-sample')
    expect(sample).toHaveTextContent('4 valid sessions across 4 separate Saturdays')
    expect(screen.getAllByText('Early signal').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/qualifying session/i)
    expect(document.body.textContent).not.toMatch(/\bPattern\b/)
  })

  test('the rate is labelled per streamed hour and estimated', () => {
    renderHero(baseAnalytics({ Saturday: cell() }))
    expect(document.body.textContent).toMatch(/~\$7\.50\/hr streamed/)
    expect(document.body.textContent).toMatch(/Estimated: imported tips don't include stream start and end times/)
  })

  test('links to the full streaming plan', () => {
    const onPlanStream = jest.fn()
    renderHero(baseAnalytics({ Saturday: cell() }), { onPlanStream })
    fireEvent.click(screen.getByRole('button', { name: /See your full streaming plan/ }))
    expect(onPlanStream).toHaveBeenCalledTimes(1)
  })

  test("with no qualifying window today it says 'Not enough data yet' and does not present another day's window as today's move", () => {
    renderHero(baseAnalytics({ Saturday: null, Wednesday: cell({ day: 'Wednesday', dayIndex: 3, hour: 9, usdPerStreamedHour: 20 }) }))
    expect(screen.getByTestId('hero-headline')).toHaveTextContent("Not enough data yet for today's best window")
    expect(document.body.textContent).not.toMatch(/Go live today/)
    expect(document.body.textContent).not.toMatch(/9:00 AM/)
    expect(screen.getByRole('button', { name: /See your full streaming plan/ })).toBeInTheDocument()
  })

  test('uses the creator timezone for "today" (Saturday 6 PM LA is already Sunday in UTC)', () => {
    jest.setSystemTime(new Date('2026-11-01T01:00:00Z')) // Sat 6:00 PM PDT = Sun 01:00 UTC
    renderHero(baseAnalytics({ Saturday: cell({ hour: 20 }), Sunday: cell({ day: 'Sunday', dayIndex: 0, hour: 21 }) }))
    expect(screen.getByTestId('hero-headline')).toHaveTextContent('Go live today 8:00 PM – 9:00 PM on BongaCams')
  })
})

describe('hero never recommends a window that has already ended', () => {
  test('at 6 PM, a 2-3 PM window is not recommended — the hero says it has passed', () => {
    jest.setSystemTime(new Date('2026-11-01T01:00:00Z')) // Saturday 6:00 PM PDT
    renderHero(baseAnalytics({ Saturday: cell({ hour: 14 }) }))
    const h = screen.getByTestId('hero-headline')
    expect(h).toHaveTextContent("Today's best window has already passed")
    expect(document.body.textContent).not.toMatch(/Go live today/)
    expect(document.body.textContent).toMatch(/Your best Saturday window was 2:00 PM – 3:00 PM on BongaCams/)
    expect(screen.getByRole('button', { name: /See your full streaming plan/ })).toBeInTheDocument()
  })

  test('picks the best window that has NOT ended: 6 PM with a better 2 PM window and a weaker 8 PM window → 8 PM', () => {
    jest.setSystemTime(new Date('2026-11-01T01:00:00Z'))
    renderHero(baseAnalytics({ Saturday: [cell({ hour: 14, usdPerStreamedHour: 9 }), cell({ hour: 20, usdPerStreamedHour: 5 })] }))
    expect(screen.getByTestId('hero-headline')).toHaveTextContent('Go live today 8:00 PM – 9:00 PM on BongaCams')
  })

  test('the window in progress counts (2:30 PM, window 2-3 PM); the same window at 3:00 PM has ended', () => {
    renderHero(baseAnalytics({ Saturday: cell({ hour: 14 }) })) // beforeEach clock = Saturday 12:00 PM PDT
    expect(screen.getByTestId('hero-headline')).toHaveTextContent('Go live today 2:00 PM – 3:00 PM')
    jest.setSystemTime(new Date('2026-10-31T21:30:00Z')) // 2:30 PM PDT, inside the window
    const second = render(<CommandCenter tz={TZ} analytics={baseAnalytics({ Saturday: cell({ hour: 14 }) })} onPlanStream={jest.fn()} />)
    expect(within(second.container).getByTestId('hero-headline')).toHaveTextContent('Go live today 2:00 PM – 3:00 PM')
    jest.setSystemTime(new Date('2026-10-31T22:00:00Z')) // 3:00 PM PDT, window ended
    const third = render(<CommandCenter tz={TZ} analytics={baseAnalytics({ Saturday: cell({ hour: 14 }) })} onPlanStream={jest.fn()} />)
    expect(within(third.container).getByTestId('hero-headline')).toHaveTextContent("Today's best window has already passed")
  })
})

describe('hero evidence area (proof bars) uses supported engine output', () => {
  test("compares today's window rate with the engine's estimatedHourlyRate, in the same per-streamed-hour units", () => {
    renderHero(baseAnalytics({ Saturday: cell() })) // window $7.50/hr, engine estimatedHourlyRate $7.50
    expect(screen.getByText('Why this window')).toBeInTheDocument()
    expect(screen.getByText('Your typical streamed hour')).toBeInTheDocument()
    expect(screen.getByText('all your valid sessions · estimated')).toBeInTheDocument()
    expect(screen.getByText('4 valid sessions · Early signal')).toBeInTheDocument()
  })

  test('"% higher" is arithmetic on the two engine rates, shown only when the window beats the typical hour', () => {
    renderHero({ ...baseAnalytics({ Saturday: cell({ usdPerStreamedHour: 9 }) }), estimatedHourlyRate: 6 })
    expect(document.body.textContent).toMatch(/50% higher/)
    renderHero({ ...baseAnalytics({ Saturday: cell({ usdPerStreamedHour: 6 }) }), estimatedHourlyRate: 9 })
    expect(document.body.textContent.match(/% higher/g)).toHaveLength(1) // second render adds none
  })

  test('no comparison is drawn without a typical rate, and no unsupported "opportunity" range exists', () => {
    renderHero({ ...baseAnalytics({ Saturday: cell() }), estimatedHourlyRate: 0 })
    expect(screen.queryByText('Why this window')).not.toBeInTheDocument()
    const src = fs.readFileSync(path.join(__dirname, '..', 'CommandCenter.js'), 'utf8')
    expect(src).not.toMatch(/missedRevenue|topGap|Estimated opportunity|\* 1\.5/)
  })
})

describe('hero reads engine output only', () => {
  test('no local aggregation or UTC-concatenated hour maths remains in CommandCenter', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'CommandCenter.js'), 'utf8')
    expect(src).not.toMatch(/canonicalBestTimes/)
    expect(src).not.toMatch(/h \+ 2/)
    expect(src).toMatch(/bestTimeWindows/)
  })
})

describe('Stream Planner uses the same windows as the hero', () => {
  const FOUR = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28']
  const SIX = ['2026-09-23', '2026-09-30', ...FOUR]
  const at = (ymd, hm) => {
    const [y, mo, d] = ymd.split('-').map(Number); const [h, mi] = hm.split(':').map(Number)
    return new Date(Date.UTC(y, mo - 1, d, h + 7, mi)).toISOString() // America/Los_Angeles = UTC-7 (PDT) on these dates
  }
  const sessionTips = (dates, platform, usd, user) => dates.flatMap((d, i) => ['10:00', '10:10', '10:20', '10:30', '10:45', '10:59'].map((hm, j) => ({
    date_time: at(d, hm), platform, username: `${user}${i}${j}`, tokens: Math.round(usd * 40), usd, tip_type: 'Tip',
  })))
  const wedTips = (dates) => sessionTips(dates, 'BongaCams', 2.5, 'fan')

  test('4 separate Wednesdays: an early signal for that window, never a confirmed peak', () => {
    const tips = wedTips(FOUR)
    const { container } = render(<StreamPlanner tips={tips} isPro tz={TZ} />)
    expect(container.textContent).toMatch(/Early signal10 AM on Wednesday looks promising so far/)
    expect(container.textContent).not.toMatch(/Peak Earning Window:/)
    expect(container.textContent).toMatch(/Wed10 AM–11 AMBongaCams/)
  })

  test('6 separate Wednesdays reach "Likely pattern": the Peak Earning Window banner shows that window, labelled streamed and estimated', () => {
    const tips = wedTips(SIX)
    expect(calculateBestTimeWindows(tips, TZ).bestByDay.Wednesday.confidence.label).toBe('Likely pattern')
    const { container } = render(<StreamPlanner tips={tips} isPro tz={TZ} />)
    expect(container.textContent).toMatch(/Likely pattern/)
    expect(container.textContent).toMatch(/Peak Earning Window: 10 AM on Wednesday/)
    expect(container.textContent).toMatch(/streamed \(estimated\) across 6 valid sessions on 6 separate days/)
  })

  test('platform agreement: a platform with one session and a higher raw rate is not named — the planner names the same platform and rate as the hero', () => {
    // BongaCams: 4 separate Wednesdays at 10-11 AM (a pattern). Chaturbate: ONE Wednesday session, much higher $/hr (not a pattern).
    const tips = [...sessionTips(FOUR, 'BongaCams', 2.5, 'bonga'), ...sessionTips(['2026-09-30'], 'Chaturbate', 20, 'cb')]
    const shared = calculateBestTimeWindows(tips, TZ)
    expect(shared.bestByDay.Wednesday).toMatchObject({ platform: 'BongaCams', hour: 10 })
    const cb = shared.platformCells.find(c => c.platform === 'Chaturbate' && c.hour === 10)
    expect(cb.usdPerStreamedHour).toBeGreaterThan(shared.bestByDay.Wednesday.usdPerStreamedHour)
    expect(cb.recommended).toBe(false)
    const { container } = render(<StreamPlanner tips={tips} isPro tz={TZ} />)
    expect(container.textContent).toMatch(new RegExp(`Wed\\s*(?:🐋)?10 AM–11 AMBongaCams\\$${shared.bestByDay.Wednesday.usdPerStreamedHour.toFixed(2).replace('.', '\\.')}`))
    expect(container.textContent).not.toMatch(/Wed\s*(?:🐋)?10 AM–11 AMChaturbate/)
  })

  test("the headline confidence is the window's own, not the whole account's: an established account with a weak Wednesday window gets 'Early signal', not a Peak Earning Window", () => {
    // 12 filler sessions (2 h each, low $) make the account-wide confidence High; the best window is still only 4 Wednesdays.
    const fillerDates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
    const filler = fillerDates.flatMap((d, i) => ['14:00', '14:30', '15:00', '15:30', '15:59'].map((hm, j) => ({
      date_time: at(d, hm), platform: 'BongaCams', username: `fill${i}${j}`, tokens: 2, usd: 0.05, tip_type: 'Tip',
    })))
    const tips = [...filler, ...wedTips(FOUR)]
    const shared = calculateBestTimeWindows(tips, TZ)
    expect(shared.overall.confidence.level).toBe('High') // account-wide
    expect(shared.bestByDay.Wednesday.confidence.level).toBe('Low') // this window
    const { container } = render(<StreamPlanner tips={tips} isPro tz={TZ} />)
    expect(container.textContent).toMatch(/Early signal10 AM on Wednesday looks promising so far/)
    expect(container.textContent).not.toMatch(/Peak Earning Window:/)
    expect(container.textContent).not.toMatch(/Strong pattern/)
  })

  test('no parallel formula remains: the planner no longer groups sessions into 4-hour blocks for its windows', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'StreamPlanner.js'), 'utf8')
    expect(src).toMatch(/calculateBestTimeWindows\(tips, tz\)/)
    const bw = src.slice(src.indexOf('function bestWindows'), src.indexOf('// Windows with 0-1 sessions'))
    expect(bw).not.toMatch(/groupIntoSessions|usdHr|combinedCells/)
    expect(src).not.toMatch(/window\.hour \+ 2/)
  })

  test('engine and planner agree: 2 separate Wednesdays is not a pattern, so no window is presented as one', () => {
    const two = [...wedTips(FOUR.slice(0, 2)), ...wedTips(FOUR.slice(0, 2)).map((t, i) => ({ ...t, username: 'x' + i, date_time: new Date(Date.parse(t.date_time) + 20 * 3600e3).toISOString() }))]
    expect(calculateBestTimeWindows(two, TZ).bestByDay.Wednesday).toBeNull()
    const { container } = render(<StreamPlanner tips={two} isPro tz={TZ} />)
    expect(container.textContent).not.toMatch(/Peak Earning Window:/)
    expect(container.textContent).not.toMatch(/looks promising so far/)
  })
})
