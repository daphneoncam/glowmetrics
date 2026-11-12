/**
 * Server-side import validation (lib/importValidation.js).
 *
 * Built from the production corruption (#733): a running token BALANCE saved
 * as USD, bare numbers/year-less strings read as dates in 2000/2001/0001, and a
 * year landing in the token column. Every observed bad shape must be rejected
 * with an actionable message, and every valid shape — including very large
 * legitimate tips and explicit payouts — must pass. The validator never caps
 * tip size: the USD ceiling is per TOKEN (what a viewer pays for one token).
 */
import { validateImportRows, isFullDate, describeProblems, IMPORT_RULES } from '../importValidation'
import { viewerRate } from '../constants'

const NOW = Date.parse('2026-11-03T20:00:00Z')
const tip = (over = {}) => ({
  platform: 'Chaturbate',
  username: 'fan',
  tokens: 100,
  usd: 5,
  tip_type: 'Tip',
  source_date: '2026-08-02 08:54:00',
  date_time: '2026-08-02T15:54:00.000Z',
  ...over,
})
const check = (rows) => validateImportRows(rows, { now: NOW })
const codes = (rows) => check(rows).problems.map((p) => p.code)

describe('isFullDate', () => {
  test.each([
    '2026-08-02 08:54:54',
    '2026-02-12 06:05:59.000000',
    '2026-08-02T15:54:00.000Z',
    '06/18/2026 14:32',
    '18.06.2026 14:32',
    'Jun 18, 2026 10:40 PM',
    'Jun 18 2026',
  ])('accepts %s', (s) => expect(isFullDate(s)).toBe(true))

  test.each(['', '   ', null, undefined, '7', '393', '17298', '2026', 'Apr 1', '4/1', 'Jun 16', 'Tip From', '1746555770'])(
    'rejects %p',
    (s) => expect(isFullDate(s)).toBe(false)
  )
})

describe('observed corruption shapes are rejected', () => {
  test('running balance saved as USD (tokens=1, usd=7886)', () => {
    const r = check([tip({ tokens: 1, usd: 7886 })])
    expect(r.ok).toBe(false)
    expect(r.problems[0].code).toBe('usd_exceeds_viewer_price')
    expect(r.problems[0].message).toMatch(/balance/i)
    expect(r.problems[0].message).toMatch(/\$7886\.00 for 1 token/)
  })

  test.each([
    [1, 7886], [3, 7881], [7, 17276], [4, 120], [4, 5], [1, 1], [8, 7262], [2026, 68465],
  ])('tokens=%i usd=%i on Chaturbate', (tokens, usd) => {
    expect(codes([tip({ tokens, usd })])).toContain('usd_exceeds_viewer_price')
  })

  test('tokens = usd (balance in both columns, as seen for one account)', () => {
    expect(codes([tip({ tokens: 2026, usd: 2026 })])).toContain('usd_exceeds_viewer_price')
  })

  test.each([
    ['a bare number', '7'],
    ['a bare 5-digit balance', '17298'],
    ['a month and day with no year', 'Apr 1'],
    ['a bare year', '2026'],
  ])('date: %s is not a full date', (_l, raw) => {
    const r = check([tip({ source_date: raw, date_time: '2001-04-01T04:00:00.000Z' })])
    expect(r.problems.map((p) => p.code)).toContain('date_not_full')
  })

  test('a missing date is rejected, never replaced with "now"', () => {
    const r = check([tip({ source_date: '', date_time: null, date_missing: true })])
    expect(r.problems[0].code).toBe('date_missing')
  })

  test('an unreadable date is rejected', () => {
    const r = check([tip({ source_date: '2026-13-45 99:99', date_time: null })])
    expect(r.problems[0].code).toBe('date_unreadable')
  })

  test.each([
    ['year 2000', '2000-04-01T04:00:00.000Z'],
    ['year 2001', '2001-06-11T22:00:00.000Z'],
    ['year 1', '0001-01-01T00:00:00.000Z'],
    ['year 349', '0349-01-01T00:00:00.000Z'],
  ])('date before the supported floor: %s', (_l, iso) => {
    const r = check([tip({ date_time: iso, source_date: '2026-08-02 08:54:00' })])
    expect(r.problems.map((p) => p.code)).toContain('date_before_floor')
  })

  test('a date years in the future (2148) is rejected', () => {
    const r = check([tip({ date_time: '2148-01-01T00:00:00.000Z' })])
    expect(r.problems.map((p) => p.code)).toContain('date_in_future')
  })

  test.each([0, -3, 1.5, NaN, null])('tokens=%p is not a whole number >= 1', (tokens) => {
    expect(codes([tip({ tokens })])).toContain('tokens_invalid')
  })

  test.each([-1, NaN, Infinity])('usd=%p is invalid', (usd) => {
    expect(codes([tip({ usd })])).toContain('usd_invalid')
  })
})

describe('valid data is never rejected', () => {
  test('ordinary tips on all three platforms at their payout rates', () => {
    const rows = [
      tip({ platform: 'Chaturbate', tokens: 100, usd: 5 }),
      tip({ platform: 'MyFreeCams', tokens: 100, usd: 5 }),
      tip({ platform: 'BongaCams', tokens: 100, usd: 2.5 }),
      tip({ platform: 'BongaCams', tokens: 1, usd: 0.03 }),
    ]
    expect(check(rows)).toMatchObject({ ok: true, problemCount: 0, rowsChecked: 4 })
  })

  test('very large legitimate tips are NOT capped (the ceiling is per token, not per tip)', () => {
    const rows = [
      tip({ tokens: 5000, usd: 250 }),
      tip({ tokens: 100000, usd: 5000 }),
      tip({ tokens: 1000000, usd: 50000 }),
    ]
    expect(check(rows).ok).toBe(true)
  })

  test('explicit BongaCams payouts between $0.02 and $0.04 per token pass', () => {
    const rows = [0.02, 0.025, 0.03, 0.04].map((rate) => tip({ platform: 'BongaCams', tokens: 450, usd: +(450 * rate).toFixed(2) }))
    expect(check(rows).ok).toBe(true)
  })

  test('whole-dollar and fractional payouts pass (9.00, 20.00, 9.50, 2.29)', () => {
    const rows = [
      tip({ platform: 'BongaCams', tokens: 450, usd: 9 }),
      tip({ platform: 'BongaCams', tokens: 450, usd: 20 }),
      tip({ platform: 'BongaCams', tokens: 450, usd: 9.5 }),
      tip({ platform: 'BongaCams', tokens: 63, usd: 2.29 }),
    ]
    expect(check(rows).ok).toBe(true)
  })

  test('the ceiling is exactly the canonical viewer purchase price per token', () => {
    const atCeiling = tip({ tokens: 1000, usd: +(1000 * viewerRate('Chaturbate')).toFixed(2) })
    const above = tip({ tokens: 1000, usd: +(1000 * viewerRate('Chaturbate') + 0.02).toFixed(2) })
    expect(check([atCeiling]).ok).toBe(true)
    expect(check([above]).ok).toBe(false)
  })

  test('platform aliases resolve to the canonical rate (BC = BongaCams)', () => {
    expect(check([tip({ platform: 'BC', tokens: 100, usd: 6.5 })]).ok).toBe(true)
    expect(check([tip({ platform: 'BC', tokens: 100, usd: 7 })]).ok).toBe(false)
  })

  test.each([
    ['ISO date-time', '2026-08-02 08:54:54', '2026-08-02T15:54:54.000Z'],
    ['ISO with fractional seconds', '2026-02-12 06:05:59.000000', '2026-02-12T14:05:59.000Z'],
    ['day-first BongaCams', '18.06.2026 14:32', '2026-06-18T21:32:00.000Z'],
    ['month-name MFC', 'Jun 18, 2026 10:40 PM', '2026-06-19T05:40:00.000Z'],
    ['explicit zone', '2026-08-02T15:54:00Z', '2026-08-02T15:54:00.000Z'],
  ])('date format accepted: %s', (_l, src, iso) => {
    expect(check([tip({ source_date: src, date_time: iso })]).ok).toBe(true)
  })

  test('a very old but plausible date (2008) and the day before "now" are accepted', () => {
    expect(check([tip({ date_time: '2008-03-01T00:00:00.000Z' })]).ok).toBe(true)
    expect(check([tip({ date_time: '2026-11-04T08:00:00.000Z' })]).ok).toBe(true) // within 24h tolerance of NOW
    expect(check([tip({ date_time: '2026-11-04T21:00:00.000Z' })]).ok).toBe(false) // > 24h ahead
  })

  test('the exact floor boundary: 2004-01-01 passes, 2003-12-31 does not', () => {
    expect(check([tip({ date_time: '2004-01-01T00:00:00.000Z' })]).ok).toBe(true)
    expect(check([tip({ date_time: '2003-12-31T23:59:59.000Z' })]).ok).toBe(false)
  })
})

describe('paid sessions: date and token rules only (their payouts are not per-token tips)', () => {
  test('a paid session with a high payout per token is not rejected by the tip ceiling', () => {
    const r = check([tip({ is_paid_session: true, tokens: 10, usd: 90 })])
    expect(r.ok).toBe(true)
  })

  test('a paid session with a broken date is still rejected', () => {
    const r = check([tip({ is_paid_session: true, date_time: '2001-04-01T04:00:00.000Z' })])
    expect(r.problems[0].code).toBe('date_before_floor')
  })
})

describe('reporting', () => {
  test('all-or-nothing: one bad row among many makes the result not ok and names the row', () => {
    const rows = Array.from({ length: 50 }, () => tip())
    rows[41] = tip({ tokens: 1, usd: 7886 })
    const r = check(rows)
    expect(r.ok).toBe(false)
    expect(r.problemCount).toBe(1)
    expect(r.problems[0].row).toBe(42)
    expect(r.rowsChecked).toBe(50)
  })

  test('only the first 20 problems are reported but the total is exact', () => {
    const rows = Array.from({ length: 75 }, () => tip({ tokens: 1, usd: 5000 }))
    const r = check(rows)
    expect(r.problems).toHaveLength(20)
    expect(r.problemCount).toBe(75)
    expect(r.truncated).toBe(true)
  })

  test('one row can have several problems; each is reported', () => {
    const r = check([tip({ tokens: 0, usd: -1, source_date: '7', date_time: '2001-07-01T00:00:00.000Z' })])
    const c = r.problems.map((p) => p.code)
    expect(c).toEqual(expect.arrayContaining(['tokens_invalid', 'usd_invalid', 'date_not_full']))
  })

  test('every problem has a code, a row number, a plain-English message and a hint', () => {
    const r = check([tip({ tokens: 1, usd: 7886 }), tip({ source_date: '7', date_time: '2001-07-01T00:00:00.000Z' })])
    for (const p of r.problems) {
      expect(typeof p.code).toBe('string')
      expect(Number.isInteger(p.row)).toBe(true)
      expect(p.message.length).toBeGreaterThan(20)
      expect(p.hint.length).toBeGreaterThan(10)
    }
  })

  test('describeProblems gives a self-contained summary for the UI error line', () => {
    const r = check([tip({ tokens: 1, usd: 7886 })])
    const text = describeProblems(r)
    expect(text).toMatch(/nothing was saved/i)
    expect(text).toMatch(/Row 1/)
  })

  test('an empty list is trivially ok', () => {
    expect(check([])).toMatchObject({ ok: true, rowsChecked: 0, problemCount: 0 })
  })

  test('rules are the approved ones (floor year 2004, 24h future tolerance)', () => {
    expect(IMPORT_RULES.MIN_YEAR).toBe(2004)
    expect(IMPORT_RULES.FUTURE_TOLERANCE_MS).toBe(24 * 60 * 60 * 1000)
  })
})
