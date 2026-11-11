import {
  localParts, validTips, verifiedShows, monthlySeries, verifiedTotals, audienceCounts,
  threeHourWindows, allTimeDailyHigh, growthStreak, audienceMilestone, effectiveRangeDays, rangeBounds,
  MILESTONES,
} from '../platformHistory'
import { liveShow } from '../sessions/__fixtures__/batch1-fixtures'

const TZ = 'America/New_York'
const iso = (s) => new Date(s).toISOString()
const tip = (id, when, platform, username, usd, live = null) => ({ id, date_time: iso(when), platform, username, usd, live_session_id: live })

describe('creator-local time', () => {
  test('a Sunday 23:30 New York tip is Sunday locally, even though it is Monday in UTC', () => {
    const ms = Date.parse('2026-11-09T04:30:00Z') // Sun 23:30 EST
    const l = localParts(ms, TZ)
    expect(l.date).toBe('2026-11-08')
    expect(l.weekday).toBe(6) // Sunday
    expect(l.hour).toBe(23)
  })
})

describe('valid tips', () => {
  test('drops zero, negative, non-numeric and undated tips; keeps canonical platform and identity', () => {
    const v = validTips([
      tip(1, '2026-10-01T12:00:00Z', 'chaturbate', 'Ann', 5),
      tip(2, '2026-10-01T12:00:00Z', 'chaturbate', 'Ann', 0),
      tip(3, '2026-10-01T12:00:00Z', 'chaturbate', 'Ann', -2),
      tip(4, '2026-10-01T12:00:00Z', 'chaturbate', 'Ann', 'x'),
      { id: 5, date_time: 'not a date', platform: 'chaturbate', username: 'Ann', usd: 3 },
      tip(6, '2026-10-01T12:00:00Z', 'chaturbate', '', 3),
    ])
    expect(v.map((t) => t.id)).toEqual([1])
    expect(v[0].platform).toBe('Chaturbate')
    expect(v[0].user).toBe('ann')
  })
})

describe('audience identity is platform:username', () => {
  test('the same username on two platforms is two fans, not one', () => {
    const range = rangeBounds(30, Date.parse('2026-11-10T00:00:00Z'))
    const t = [
      tip(1, '2026-11-01T12:00:00Z', 'chaturbate', 'Ann', 5),
      tip(2, '2026-11-02T12:00:00Z', 'bongacams', 'Ann', 5),
    ]
    const s = monthlySeries({ tips: t, shows: [], tz: TZ, range })
    const audience = s.months.map((m) => s.platforms.reduce((n, p) => n + s.byPlatform[p][m].audience, 0))
    expect(audience[audience.length - 1]).toBe(2)
    expect(audienceCounts({ tips: t, periodStart: range.start, periodEnd: range.end }).active).toBe(2)
  })
})

describe('monthly series', () => {
  // Mid-month start: a range that begins at UTC midnight on the 1st is still the previous month in New York.
  const range = { start: Date.parse('2026-08-02T12:00:00Z'), end: Date.parse('2026-10-31T23:59:59Z') }
  test('earnings are per platform, not combined; months are continuous with zeros where nothing was earned', () => {
    const t = [
      tip(1, '2026-08-05T12:00:00Z', 'chaturbate', 'a', 10),
      tip(2, '2026-10-05T12:00:00Z', 'bongacams', 'b', 4),
    ]
    const s = monthlySeries({ tips: t, shows: [], tz: TZ, range })
    expect(s.months).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(s.byPlatform.Chaturbate['2026-08'].earnings).toBe(10)
    expect(s.byPlatform.Chaturbate['2026-10'].earnings).toBe(0)
    expect(s.byPlatform.BongaCams['2026-08'].earnings).toBe(0) // a month with no earnings is a real 0, not a gap
  })
  test('imported-only data gives no hours and no $/hr (no estimated spans)', () => {
    const t = [tip(1, '2026-08-05T12:00:00Z', 'chaturbate', 'a', 10), tip(2, '2026-08-05T12:40:00Z', 'chaturbate', 'a', 10)]
    const s = monthlySeries({ tips: t, shows: [], tz: TZ, range })
    expect(s.byPlatform.Chaturbate['2026-08'].hours).toBe(0)
    expect(s.byPlatform.Chaturbate['2026-08'].usdPerHour).toBeNull()
  })
  test('a verified single-platform Live show gives hours and $/hr; a multi-platform show is excluded and counted', () => {
    const solo = liveShow({ id: 's1', platform: 'Chaturbate', startedAt: iso('2026-08-10T20:00:00Z'), minutes: 120, publicUsd: 60, privateUsd: 0, tipCount: 2, uniqueTippers: 2 })
    const multi = liveShow({ id: 's2', platform: 'Chaturbate', startedAt: iso('2026-08-12T20:00:00Z'), minutes: 60, publicUsd: 30, privateUsd: 0, tipCount: 2, uniqueTippers: 2,
      platformRevenue: [{ platform: 'chaturbate', usd: 15, tips: 1 }, { platform: 'bongacams', usd: 15, tips: 1 }] })
    const s = monthlySeries({ tips: [], shows: [solo, multi], tz: TZ, range })
    expect(s.byPlatform.Chaturbate['2026-08'].hours).toBe(2)
    expect(s.byPlatform.Chaturbate['2026-08'].usdPerHour).toBe(30)
    expect(s.multiPlatformShows).toBe(1)
  })
})

describe('verified totals', () => {
  test('hours and $/hr come only from verified shows', () => {
    const solo = liveShow({ id: 's1', startedAt: iso('2026-10-10T20:00:00Z'), minutes: 120, publicUsd: 60, privateUsd: 0, tipCount: 2, uniqueTippers: 2 })
    const unverified = { ...liveShow({ id: 's9', startedAt: iso('2026-10-11T20:00:00Z'), minutes: 60, publicUsd: 500, privateUsd: 0, tipCount: 2, uniqueTippers: 2 }), endedHow: 'unknown' }
    expect(verifiedShows([solo, unverified]).map((s) => s.id)).toEqual(['s1'])
    const r = { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-31T00:00:00Z') }
    expect(verifiedTotals({ shows: [solo, unverified], range: r })).toEqual({ shows: 1, hours: 2, usd: 60, usdPerHour: 30 })
  })
})

describe('three-hour timing windows', () => {
  const range = { start: Date.parse('2026-09-01T00:00:00Z'), end: Date.parse('2026-11-30T00:00:00Z') }
  test('a window needs at least three distinct local streaming dates', () => {
    // 1 hour streamed on two dates: not enough to rank
    const sh = [
      liveShow({ id: 'a', startedAt: iso('2026-10-10T00:00:00Z'), minutes: 60, publicUsd: 20, privateUsd: 0, tipCount: 1, uniqueTippers: 1 }),
      liveShow({ id: 'b', startedAt: iso('2026-10-11T00:00:00Z'), minutes: 60, publicUsd: 20, privateUsd: 0, tipCount: 1, uniqueTippers: 1 }),
    ]
    const r = threeHourWindows({ tips: [], shows: sh, tz: 'UTC', range: { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-31T00:00:00Z') } })
    expect(r.ranked).toHaveLength(0)
    expect(r.windows.every((w) => !w.qualifies)).toBe(true)
  })
  test('three distinct dates qualify; rate is earnings / verified streamed hours inside the window', () => {
    const sh = [0, 1, 2].map((i) => liveShow({ id: `d${i}`, startedAt: iso(`2026-10-1${i}T00:00:00Z`), minutes: 60, publicUsd: 30, privateUsd: 0, tipCount: 1, uniqueTippers: 1 }))
    const linked = [0, 1, 2].map((i) => tip(100 + i, `2026-10-1${i}T00:30:00Z`, 'chaturbate', 'fan', 30, `d${i}`))
    const r = threeHourWindows({ tips: linked, shows: sh, tz: 'UTC', range: { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-31T00:00:00Z') } })
    const w = r.windows.find((x) => x.startHour === 0)
    expect(w.qualifies).toBe(true)
    expect(w.dates).toBe(3)
    expect(w.hours).toBe(3)            // 3 verified hours, all inside 00:00–03:00 UTC
    expect(w.usdPerHour).toBe(30)      // 90 / 3
  })
  test('windows are in creator-local time, not UTC', () => {
    // 22:00–23:00 UTC is 18:00–19:00 New York: the window starting at 6 PM must be the one credited
    const sh = [0, 1, 2].map((i) => liveShow({ id: `n${i}`, startedAt: iso(`2026-10-1${i}T22:00:00Z`), minutes: 60, publicUsd: 30, privateUsd: 0, tipCount: 1, uniqueTippers: 1 }))
    const r = threeHourWindows({ tips: [], shows: sh, tz: TZ, range })
    expect(r.windows.find((x) => x.startHour === 18).hours).toBe(3)
    expect(r.windows.find((x) => x.startHour === 22)).toBeTruthy()
  })
  test('unverifiable shows (pauses) are excluded from placement and counted', () => {
    const paused = liveShow({ id: 'p', startedAt: iso('2026-10-10T00:00:00Z'), minutes: 60, publicUsd: 20, privateUsd: 0, tipCount: 1, uniqueTippers: 1, pausedSeconds: 1800 })
    const r = threeHourWindows({ tips: [], shows: [paused], tz: 'UTC', range: { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-31T00:00:00Z') } })
    expect(r.usedShows).toBe(0)
    expect(r.excludedShows).toBe(1)
  })
})

describe('all-time daily high', () => {
  test('sums valid earnings per creator-local day', () => {
    const t = [
      tip(1, '2026-10-05T03:00:00Z', 'chaturbate', 'a', 10), // Oct 4, 11 PM NY
      tip(2, '2026-10-04T23:30:00Z', 'chaturbate', 'b', 15), // Oct 4, 7:30 PM NY
      tip(3, '2026-10-06T15:00:00Z', 'chaturbate', 'c', 20), // Oct 6
    ]
    expect(allTimeDailyHigh({ tips: t, tz: TZ })).toEqual({ date: '2026-10-04', usd: 25 })
  })
  test('null with no valid earnings', () => {
    expect(allTimeDailyHigh({ tips: [], tz: TZ })).toBeNull()
  })
})

describe('growth streak (completed Mon–Sun weeks)', () => {
  // Now: Wed 2026-11-11 NY. Completed weeks: Oct 19, Oct 26, Nov 2, Nov 9... Nov 9 week is complete? No: Nov 9 (Mon) to Nov 15 is current.
  const now = Date.parse('2026-11-11T16:00:00Z')
  const weekTip = (id, day, usd) => tip(id, `${day}T16:00:00Z`, 'chaturbate', 'a', usd)
  test('two consecutive growing weeks activate a streak; the current incomplete week is ignored', () => {
    const t = [
      weekTip(1, '2026-10-19', 10), // week of Oct 19
      weekTip(2, '2026-10-26', 20), // week of Oct 26: grew
      weekTip(3, '2026-11-02', 30), // week of Nov 2: grew
      weekTip(4, '2026-11-10', 999), // current week (Nov 9): excluded
    ]
    const g = growthStreak({ tips: t, tz: TZ, nowMs: now })
    expect(g.streak).toBe(2)
    expect(g.active).toBe(true)
  })
  test('a zero-earnings week never counts as a growth week', () => {
    const t = [weekTip(1, '2026-10-19', 10), weekTip(2, '2026-11-02', 30)] // Oct 26 week is empty
    const g = growthStreak({ tips: t, tz: TZ, nowMs: now })
    // Nov 2 week is above the empty Oct 26 week, but the Oct 26 week itself is zero, so the run is one week
    expect(g.streak).toBe(1)
    expect(g.active).toBe(false)
  })
  test('one growing week is not an active streak', () => {
    const t = [weekTip(1, '2026-10-19', 10), weekTip(2, '2026-10-26', 20)]
    expect(growthStreak({ tips: t, tz: TZ, nowMs: now }).active).toBe(false)
  })
})

describe('audience milestones', () => {
  test('latest achieved and next threshold on distinct platform:username', () => {
    const t = Array.from({ length: 30 }, (_, i) => tip(i, '2026-10-01T12:00:00Z', 'chaturbate', `fan${i}`, 1))
    const m = audienceMilestone({ tips: t })
    expect(m.fans).toBe(30)
    expect(m.latest).toBe(25)
    expect(m.next).toBe(50)
    expect(m.progress).toBeCloseTo((30 - 25) / (50 - 25), 2)
    expect(MILESTONES).toEqual([10, 25, 50, 100, 250])
  })
  test('under the first threshold: no achieved milestone', () => {
    const m = audienceMilestone({ tips: [tip(1, '2026-10-01T12:00:00Z', 'chaturbate', 'a', 1)] })
    expect(m.latest).toBeNull()
    expect(m.next).toBe(10)
  })
})

describe('returning and new audience', () => {
  test('returning = active in period and seen before; new = first ever tip in period', () => {
    const t = [
      tip(1, '2026-09-01T12:00:00Z', 'chaturbate', 'old', 5),
      tip(2, '2026-10-05T12:00:00Z', 'chaturbate', 'old', 5),
      tip(3, '2026-10-06T12:00:00Z', 'chaturbate', 'newbie', 5),
    ]
    const c = audienceCounts({ tips: t, periodStart: Date.parse('2026-10-01T00:00:00Z'), periodEnd: Date.parse('2026-10-31T00:00:00Z') })
    expect(c).toEqual({ active: 2, returning: 1, new: 1 })
  })
})

describe('plan date window', () => {
  test('Free is capped at 31 days; Pro may use 30 or 90', () => {
    expect(effectiveRangeDays(90, false)).toBe(31)
    expect(effectiveRangeDays(30, false)).toBe(30)
    expect(effectiveRangeDays(90, true)).toBe(90)
  })
})

describe('platform growth record ($50 minimum base, completed months)', () => {
  const { platformGrowthRecord, PLATFORM_GROWTH_MIN_BASE } = require('../platformHistory')
  const now = Date.parse('2026-11-11T16:00:00Z') // November is the current, incomplete month
  const m = (id, month, platform, usd) => tip(id, `${month}-15T16:00:00Z`, platform, `f${id}`, usd)

  test('largest single-platform month-over-month increase', () => {
    const t = [m(1, '2026-08', 'bongacams', 100), m(2, '2026-09', 'bongacams', 150), // +50%
      m(3, '2026-09', 'chaturbate', 200), m(4, '2026-10', 'chaturbate', 500)]             // +150%
    expect(platformGrowthRecord({ tips: t, tz: TZ, nowMs: now })).toEqual({ platform: 'Chaturbate', fromMonth: '2026-09', toMonth: '2026-10', fromUsd: 200, toUsd: 500, pct: 150 })
  })
  test('the earlier month must have at least $50', () => {
    expect(PLATFORM_GROWTH_MIN_BASE).toBe(50)
    const t = [m(1, '2026-09', 'bongacams', 3), m(2, '2026-10', 'bongacams', 40), // tiny base: ignored
      m(3, '2026-09', 'chaturbate', 50), m(4, '2026-10', 'chaturbate', 60)]        // exactly $50: counts
    const r = platformGrowthRecord({ tips: t, tz: TZ, nowMs: now })
    expect(r.platform).toBe('Chaturbate')
    expect(r.pct).toBe(20)
  })
  test('the current incomplete month is excluded', () => {
    const t = [m(1, '2026-10', 'chaturbate', 100), m(2, '2026-11', 'chaturbate', 900)]
    expect(platformGrowthRecord({ tips: t, tz: TZ, nowMs: now })).toBeNull()
  })
  test('platforms are compared on their own months, never combined', () => {
    // Combined Sep $100 -> Oct $180 would be +80%; per platform neither grew.
    const t = [m(1, '2026-09', 'chaturbate', 100), m(2, '2026-10', 'chaturbate', 90), m(3, '2026-10', 'bongacams', 90)]
    expect(platformGrowthRecord({ tips: t, tz: TZ, nowMs: now })).toBeNull()
  })
  test('a month with no earnings breaks the comparison (compared as $0, never skipped)', () => {
    const t = [m(1, '2026-07', 'chaturbate', 100), m(2, '2026-09', 'chaturbate', 300)] // August empty
    expect(platformGrowthRecord({ tips: t, tz: TZ, nowMs: now })).toBeNull()
  })
  test('declines only: no record', () => {
    const t = [m(1, '2026-09', 'chaturbate', 300), m(2, '2026-10', 'chaturbate', 100)]
    expect(platformGrowthRecord({ tips: t, tz: TZ, nowMs: now })).toBeNull()
  })
})
