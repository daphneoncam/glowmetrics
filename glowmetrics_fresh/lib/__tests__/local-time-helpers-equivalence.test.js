/**
 * #667: toLocalHour / toLocalDow / toLocalDateStr reuse one Intl.DateTimeFormat
 * per timezone instead of building a new one for every tip (that made
 * aggregateRows take 10–36s on ~12k tips). Speed only — these tests pin the
 * output to the previous implementation, byte for byte.
 */
import crypto from 'crypto'
import { aggregateRows, toLocalHour, toLocalDow } from '../analytics'

// Previous implementations, verbatim.
function oldHour(dateStr, tz) {
  try {
    const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(dateStr)))
    return isNaN(h) ? 0 : h === 24 ? 0 : h
  } catch { return new Date(dateStr).getUTCHours() }
}
function oldDow(dateStr, tz) {
  try {
    const d = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(dateStr))
    return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(d)
  } catch { return new Date(dateStr).getUTCDay() }
}

const TZS = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Australia/Lord_Howe', undefined, null, 'Not/AZone']

// Deterministic dataset shaped like a large real import: ~12k tips, 270 fans, one month.
function dataset(n = 12277, fans = 270) {
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const start = Date.parse('2026-09-09T04:48:55Z'), end = Date.parse('2026-10-08T11:17:50Z')
  const shows = []; for (let d = 0; d < 29; d++) if (r() < 0.85) shows.push(start + d * 864e5 + r() * 6 * 36e5)
  const rows = []
  for (let i = 0; i < n; i++) {
    const t = Math.min(end, shows[Math.floor(r() * shows.length)] + r() * 5 * 36e5)
    const tok = [1, 5, 10, 20, 25, 50, 100, 300][Math.floor(r() * r() * 8)]
    rows.push({ id: i + 1, user_id: 'u', date_time: new Date(t).toISOString(), platform: 'Chaturbate', username: 'fan' + Math.floor(r() * r() * fans), tokens: tok, usd: +(tok * 0.05).toFixed(2), tip_type: 'Tip', tip_note: '' })
  }
  return rows.sort((a, b) => (a.date_time < b.date_time ? -1 : 1))
}

test('hour and weekday match the previous implementation (DST edges, invalid tz, bad dates)', () => {
  const dates = ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-10-25T00:59:00Z', '2026-12-31T23:59:59Z', '2026-01-01T00:00:00Z', 'not a date']
  for (let h = 0; h < 24 * 14; h++) dates.push(new Date(Date.UTC(2026, 9, 1) + h * 36e5 + 17 * 6e4).toISOString())
  for (const tz of TZS) for (const d of dates) {
    expect(toLocalHour(d, tz)).toBe(oldHour(d, tz))
    expect(toLocalDow(d, tz)).toBe(oldDow(d, tz))
  }
})

// aggregateRows reads the current date (30-day momentum), so pin the clock.
const FIXED_NOW = new Date('2026-10-10T00:00:00Z')
beforeEach(() => { jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick'] }) })
afterEach(() => { jest.useRealTimers() })

// Fingerprints of aggregateRows on this exact dataset. Re-recorded once, in the
// Batch 1 dashboard correction, after reviewing every changed field against
// independently computed creator-local expectations: new fields
// (platformDayActivity, *.localDates); fan typical hours, the tonight forecast
// and the peak-missed alert now on the creator's clock (New York, Kolkata);
// Kolkata weekday best hours that had < 3 distinct local dates no longer
// qualify. UTC: no pre-existing field changed.
// Hero batch: re-recorded again for the single new output field
// bestTimeWindows ($ per streamed hour); verified that every pre-existing field
// is byte-identical in all three zones.
// Hero review fixes: re-recorded for the structural change only (combinedCells
// removed; recommended / recommendedByDay added) — no pre-existing field and no
// bestTimeWindows cell value changed in any of the three zones.
const EXPECTED = require('./fixtures/aggregate-rows-fingerprints.json')
for (const tz of Object.keys(EXPECTED)) {
  test(`aggregateRows output unchanged for ${tz}`, () => {
    const out = JSON.stringify(aggregateRows(dataset(), tz))
    expect(crypto.createHash('sha256').update(out).digest('hex')).toBe(EXPECTED[tz])
  })
}

test('aggregateRows on 12,277 tips finishes in under 5 seconds', () => {
  const t0 = Date.now()
  aggregateRows(dataset(), 'America/New_York')
  expect(Date.now() - t0).toBeLessThan(5000)
})
