/**
 * parseCSV({ strictDates: true }): a row whose date cell is empty must be
 * FLAGGED (date_missing) instead of being silently stamped with the current
 * time. The default (non-strict) behaviour used by the dashboard must be
 * unchanged. Regression for #733/#734.
 */
import { parseCSV } from '../../analytics.js'

const HEADER = 'date_time,username,tokens,usd'
const csv = (...rows) => [HEADER, ...rows].join('\n')

describe('parseCSV strictDates', () => {
  test('default mode is unchanged: an empty date is stamped with the current time', () => {
    const before = Date.now()
    const rows = parseCSV(csv(',fanA,10,0.5'), 'Chaturbate')
    expect(rows).toHaveLength(1)
    const stamped = new Date(rows[0].dateRaw).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before - 1000)
    expect(rows[0].date_missing).toBeUndefined()
  })

  test('strict mode flags the empty date and never invents one', () => {
    const rows = parseCSV(csv(',fanA,10,0.5'), 'Chaturbate', { strictDates: true })
    expect(rows).toHaveLength(1)
    expect(rows[0].date_missing).toBe(true)
    expect(rows[0].dateRaw).toBeFalsy()
    expect(rows[0].date_time).toBeFalsy()
  })

  test('strict mode keeps the other rows of the file intact', () => {
    const rows = parseCSV(csv('2026-08-02 08:54:54,fanA,10,0.5', ',fanB,20,1', '2026-08-02 08:55:00,fanC,30,1.5'), 'Chaturbate', { strictDates: true })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => !!r.date_missing)).toEqual([false, true, false])
  })

  test('valid files parse identically in strict and default mode', () => {
    const text = csv('2026-08-02 08:54:54,fanA,10,0.5', '2026-08-03 09:00:00,fanB,25,1.25')
    expect(parseCSV(text, 'Chaturbate', { strictDates: true })).toEqual(parseCSV(text, 'Chaturbate'))
  })

  test('the strict flag does not leak into a later default call', () => {
    parseCSV(csv(',fanA,10,0.5'), 'Chaturbate', { strictDates: true })
    const rows = parseCSV(csv(',fanA,10,0.5'), 'Chaturbate')
    expect(rows[0].date_missing).toBeUndefined()
    expect(rows[0].dateRaw).toBeTruthy()
  })

  test('a bare-number date survives parsing with its raw text so the validator can reject it', () => {
    const rows = parseCSV(csv('7,fanA,10,0.5'), 'Chaturbate', { strictDates: true })
    expect(rows).toHaveLength(1)
    expect(String(rows[0].dateRaw)).toBe('7')
  })
})
