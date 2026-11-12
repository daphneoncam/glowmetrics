/**
 * calculateBestTimeWindows — the documented best-time formula, implemented once.
 *   bucket = platform x creator-local weekday x creator-local hour
 *   rate   = USD / streamed hours, from valid sessions (>= 30 min AND >= 2 tips)
 *   zero-tip minutes inside a valid session count in the denominator
 *   eligible = streamed on >= 3 distinct creator-local dates
 *   confidence = calculateConfidence(validSessionCount, streamedHours)
 */
import { calculateBestTimeWindows, aggregateRows, calculateConfidence, BEST_TIME_MIN_LOCAL_DATES } from '../../analytics'

function localToUtc(ymd, hm, tz) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const target = Date.UTC(y, mo - 1, d, h, mi)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess)).map(x => [x.type, x.value]))
    guess += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  }
  return new Date(guess).toISOString()
}
const tip = (tz, ymd, hm, username, usd = 5, platform = 'BongaCams') => ({ date_time: localToUtc(ymd, hm, tz), platform, username, tokens: usd * 40, usd })
const WEDNESDAYS = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'] // verified Wednesdays
const SATURDAYS = ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24']

// One valid session per date: tips at startHm and endHm.
const sessionsOn = (tz, dates, startHm, endHm, usd = 5, platform = 'BongaCams') =>
  dates.flatMap((d, i) => [tip(tz, d, startHm, `a${i}${startHm}`, usd, platform), tip(tz, d, endHm, `b${i}${startHm}`, usd, platform)])

describe('formula', () => {
  const tz = 'America/Los_Angeles'
  test('rate = USD / streamed hours; zero-tip minutes inside the session are in the denominator', () => {
    // 10:00 and 10:50 local: 50 streamed minutes, only two tips ($10 total), minutes between them have no tips.
    const rows = sessionsOn(tz, WEDNESDAYS, '10:00', '10:50')
    const r = calculateBestTimeWindows(rows, tz)
    const c = r.platformCells.find(x => x.day === 'Wednesday' && x.hour === 10)
    expect(c.streamedMinutes).toBe(200) // 4 dates x 50 min
    expect(c.totalUSD).toBe(40)
    expect(c.usdPerStreamedHour).toBe(12) // 40 / (200/60) = 12.00, not $ per tipped hour
    expect(c.validSessionCount).toBe(4)
    expect(c.localDates).toBe(4)
  })

  test('hours are numbers and the window is exactly the measured 1-hour bucket', () => {
    const r = calculateBestTimeWindows(sessionsOn(tz, WEDNESDAYS, '10:00', '10:50'), tz)
    expect(typeof r.platformCells[0].hour).toBe('number')
    expect(r.platformCells[0].hour + 1).toBe(11) // not "10" + 1 = "101"
  })

  test('only valid sessions count: < 30 min, single-tip and same-minute sessions are excluded', () => {
    const short = sessionsOn(tz, WEDNESDAYS, '12:00', '12:20')              // 20 min
    const single = WEDNESDAYS.map((d, i) => tip(tz, d, '14:00', `s${i}`))    // 1 tip
    const sameMinute = WEDNESDAYS.flatMap((d, i) => [tip(tz, d, '16:00', `m${i}`), tip(tz, d, '16:00', `n${i}`)]) // duration unknown
    const r = calculateBestTimeWindows([...short, ...single, ...sameMinute], tz)
    expect(r.platformCells).toEqual([])
    expect(r.overall.validSessionCount).toBe(0)
  })

  test('streamed time is always labelled an estimate (tip span, not real start/end)', () => {
    const r = calculateBestTimeWindows(sessionsOn(tz, WEDNESDAYS, '10:00', '10:50'), tz)
    expect(r.durationBasis).toBe('tip_span_estimate')
    expect(r.platformCells.every(c => c.durationBasis === 'tip_span_estimate')).toBe(true)
  })

  test('a window with no streamed time cannot exist (best hour across weekdays does not invent a Wednesday window)', () => {
    // Streams only on Saturdays at 2 PM and Wednesdays at 9 AM.
    const rows = [...sessionsOn(tz, SATURDAYS, '14:00', '14:50'), ...sessionsOn(tz, WEDNESDAYS, '09:00', '09:50', 3)]
    const r = calculateBestTimeWindows(rows, tz)
    expect(r.platformCells.find(c => c.day === 'Wednesday' && c.hour === 14)).toBeUndefined()
    expect(r.platformCells.find(c => c.day === 'Saturday' && c.hour === 14)).toBeDefined()
  })

  test('per-platform cells stay separate; only a platform whose own cell is a pattern is recommended', () => {
    // Different Wednesdays per platform (the session rule splits when platforms interleave).
    const CB_WEDNESDAYS = ['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']
    const rows = [...sessionsOn(tz, WEDNESDAYS, '10:00', '10:59', 5, 'BongaCams'), ...sessionsOn(tz, CB_WEDNESDAYS.slice(0, 1), '10:00', '10:59', 50, 'Chaturbate')]
    const r = calculateBestTimeWindows(rows, tz)
    const wed10 = r.platformCells.filter(c => c.day === 'Wednesday' && c.hour === 10)
    expect(wed10.map(c => c.platform).sort()).toEqual(['BongaCams', 'Chaturbate'])
    expect(wed10.find(c => c.platform === 'Chaturbate').usdPerStreamedHour).toBeGreaterThan(wed10.find(c => c.platform === 'BongaCams').usdPerStreamedHour)
    expect(r.bestByDay.Wednesday.platform).toBe('BongaCams') // the higher raw rate on ONE date is not a pattern
    expect(r.recommendedByDay.Wednesday.map(c => c.platform)).toEqual(['BongaCams'])
    expect(r.combinedCells).toBeUndefined() // one definition of a window: platform x weekday x hour
  })

  test('recommendedByDay lists every recommended cell for the weekday, best rate first', () => {
    const rows = [...sessionsOn(tz, WEDNESDAYS, '10:00', '10:59', 5), ...sessionsOn(tz, WEDNESDAYS, '15:00', '15:59', 2)]
    const list = calculateBestTimeWindows(rows, tz).recommendedByDay.Wednesday
    expect(list.map(c => c.hour)).toEqual([10, 15])
    expect(list[0].usdPerStreamedHour).toBeGreaterThan(list[1].usdPerStreamedHour)
    expect(list.every(c => c.recommended)).toBe(true)
  })

  test('boundary allocation: USD goes to the hour a tip was received in (not pro-rated); minutes by overlap', () => {
    // 2:30-3:20 PM: tips $4 at 2:30, $6 at 3:20. Hour 14 gets 30 min and the 2:30 tip; hour 15 gets 20 min and the 3:20 tip.
    const rows = ['2026-10-07', '2026-10-14', '2026-10-21'].flatMap((d, i) => [tip(tz, d, '14:30', 'a' + i, 4), tip(tz, d, '15:20', 'b' + i, 6)])
    const r = calculateBestTimeWindows(rows, tz)
    const h14 = r.platformCells.find(c => c.hour === 14), h15 = r.platformCells.find(c => c.hour === 15)
    expect(h14).toMatchObject({ streamedMinutes: 90, totalUSD: 12, usdPerStreamedHour: 8 })
    expect(h15).toMatchObject({ streamedMinutes: 60, totalUSD: 18, usdPerStreamedHour: 18 })
  })

  test('a tip stamped exactly at the session end is allocated to the last streamed hour — no zero-minute cell, no phantom session or date', () => {
    // 2:30-3:00 PM sharp, $5 at each end, on 3 dates.
    const rows = WEDNESDAYS.slice(0, 3).flatMap((d, i) => [tip(tz, d, '14:30', 'a' + i, 5), tip(tz, d, '15:00', 'b' + i, 5)])
    const r = calculateBestTimeWindows(rows, tz)
    expect(r.platformCells.map(c => c.hour)).toEqual([14]) // no hour-15 cell at all
    expect(r.platformCells[0]).toMatchObject({ streamedMinutes: 90, totalUSD: 30, validSessionCount: 3, localDates: 3, usdPerStreamedHour: 20 })
    expect(r.platformCells.every(c => c.streamedMinutes > 0)).toBe(true)
  })

  test('total USD in cells equals total USD of the valid sessions (nothing lost or double counted at boundaries)', () => {
    // Saturday sessions have a middle tip so no gap exceeds the 60-minute session rule.
    const sat = SATURDAYS.flatMap((d, i) => [tip(tz, d, '13:30', 'a' + i, 3), tip(tz, d, '14:15', 'm' + i, 3), tip(tz, d, '15:00', 'b' + i, 3)])
    const rows = [...sessionsOn(tz, WEDNESDAYS, '10:00', '11:00'), ...sat]
    const r = calculateBestTimeWindows(rows, tz)
    expect(r.platformCells.reduce((n, c) => n + c.totalUSD, 0)).toBeCloseTo(rows.reduce((n, t) => n + t.usd, 0), 2)
  })
})

describe('>= 3 distinct creator-local dates and confidence', () => {
  const tz = 'America/Los_Angeles'
  test('2 dates: not eligible; 3 dates: eligible but "Not enough data yet" (Very Low) so not recommended', () => {
    const two = calculateBestTimeWindows(sessionsOn(tz, WEDNESDAYS.slice(0, 2), '10:00', '10:50'), tz)
    expect(two.platformCells[0].eligible).toBe(false)
    expect(two.bestByDay.Wednesday).toBeNull()
    const three = calculateBestTimeWindows(sessionsOn(tz, WEDNESDAYS.slice(0, 3), '10:00', '10:59'), tz)
    expect(BEST_TIME_MIN_LOCAL_DATES).toBe(3)
    const c = three.platformCells.find(x => x.hour === 10)
    expect(c.eligible).toBe(true)
    expect(c.confidence.level).toBe('Very Low') // 3 sessions but < 3 streamed hours
    expect(three.bestByDay.Wednesday).toBeNull()
  })

  test('4 full-hour dates reach "Early signal" (Low) and are recommended, with the canonical label', () => {
    const r = calculateBestTimeWindows(sessionsOn(tz, WEDNESDAYS, '10:00', '10:59'), tz)
    const best = r.bestByDay.Wednesday
    expect(best).toMatchObject({ day: 'Wednesday', hour: 10, platform: 'BongaCams', localDates: 4, validSessionCount: 4 })
    expect(best.confidence).toEqual(calculateConfidence(4, best.streamedHours))
    expect(best.confidence.label).toBe('Early signal')
  })

  test('calculateConfidence is a per-window gate here: its bands need >= 3 sessions AND >= 3 streamed hours, so a 1-hour window needs >= 4 dates to leave "Very Low"', () => {
    expect(calculateConfidence(3, 2.95).level).toBe('Very Low')
    expect(calculateConfidence(4, 3.93).level).toBe('Low')
  })
})

describe.each(['America/Los_Angeles', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/St_Johns', 'Australia/Lord_Howe', 'Pacific/Kiritimati'])('creator timezone %s (explicit)', (tz) => {
  test('a session crossing a local hour boundary is split into the right local hours', () => {
    // 14:40 -> 15:20 local on 3 local Wednesdays: 20 min in hour 14, 20 min in hour 15 — in every offset, incl. :30 and :45 zones.
    const rows = sessionsOn(tz, WEDNESDAYS.slice(0, 3), '14:40', '15:20')
    const r = calculateBestTimeWindows(rows, tz)
    const h14 = r.platformCells.find(c => c.hour === 14)
    const h15 = r.platformCells.find(c => c.hour === 15)
    expect(h14.streamedMinutes).toBe(60)  // 3 dates x 20
    expect(h15.streamedMinutes).toBe(60)
    expect(h14.day).toBe('Wednesday')
    expect(h14.localDates).toBe(3)
    expect(h14.eligible).toBe(true)
  })

  test('weekday and date are creator-local across local midnight (Friday 23:10-23:50 stays Friday)', () => {
    const fridays = ['2026-10-09', '2026-10-16', '2026-10-23']
    const r = calculateBestTimeWindows(sessionsOn(tz, fridays, '23:10', '23:50'), tz)
    const c = r.platformCells.find(x => x.hour === 23)
    expect(c.day).toBe('Friday')
    expect(c.localDates).toBe(3)
  })

  test('aggregateRows exposes the same result as bestTimeWindows (shared engine output)', () => {
    const rows = sessionsOn(tz, WEDNESDAYS, '10:00', '10:59')
    const viaEngine = aggregateRows(rows, tz).bestTimeWindows
    expect(viaEngine.bestByDay.Wednesday).toMatchObject({ day: 'Wednesday', hour: 10, localDates: 4 })
  })
})

test('empty input returns the insufficient-data shape', () => {
  const r = calculateBestTimeWindows([], 'UTC')
  expect(r.platformCells).toEqual([])
  expect(Object.values(r.bestByDay).every(v => v === null)).toBe(true)
  expect(r.overall.confidence.level).toBe('Very Low')
})
