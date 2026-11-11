/**
 * Real creator export (fan usernames replaced by pseudonyms; dates, tokens,
 * payouts and layout exactly as exported): a BongaCams history kept in a
 * spreadsheet. Shape quirks: two columns both headed "Tokens" (the first
 * holds the type, "Tips"), a USD column already rounded to cents by the
 * sheet, an empty second table on the right, and a junk last row.
 *
 * Expected values were computed independently from the raw file with a
 * separate Python script (not with production helpers):
 *   406 tip rows, 2,636 tokens, CSV payout total $60.55, 88 distinct fans,
 *   dates 2024-12-29 .. 2026-02-23, all type "Tips".
 */
import fs from 'fs'
import path from 'path'
import { parseCSV, aggregateRows } from '../analytics'

const FILE = path.join(__dirname, 'fixtures/real-exports/bongacams-sheet-export-2026.anon.csv')
const csv = fs.readFileSync(FILE, 'utf8')
const milli = (usd) => Math.round(usd * 1000)

describe('real BongaCams spreadsheet export', () => {
  const rows = parseCSV(csv, 'BongaCams')

  test('every tip row is imported and the junk/blank rows are not', () => {
    expect(rows).toHaveLength(406)
  })

  test('platform, tokens and fans match the raw file', () => {
    expect(rows.every((r) => r.platform === 'BongaCams')).toBe(true)
    expect(rows.reduce((s, r) => s + r.tokens, 0)).toBe(2636)
    expect(new Set(rows.map((r) => r.username)).size).toBe(88)
  })

  test('the payout column is kept as exported (total $60.55), with the token value alongside', () => {
    expect(rows.reduce((s, r) => s + milli(r.usd), 0)).toBe(60550)
    expect(rows.every((r) => r.usd_source === 'payout')).toBe(true)
    expect(rows.reduce((s, r) => s + milli(r.usd_from_tokens), 0)).toBe(2636 * 25) // $65.90 at $0.025/token
  })

  // Source dates are day-first (DD.MM.YYYY). Every parsed row must keep the
  // same day, month and year: a day-first date read month-first would move
  // 01.04.2025 (1 April) to 4 January.
  // One source row (line 401) is month-first, "2/23/2026 23:41:00", while its
  // session id says BC-2025-01-04: a manual edit in the creator's sheet. It is
  // checked on its own; every other row is day-first.
  const dataLines = csv.split('\n').slice(1).filter((l) => l.split(',')[1])

  test('every day-first row keeps its date (no day/month swap)', () => {
    expect(dataLines).toHaveLength(rows.length)
    const swapped = rows.filter((r, i) => {
      if (!/^\d{2}\.\d{2}\.\d{4}/.test(dataLines[i])) return false
      const [d, m, y] = dataLines[i].slice(0, 10).split('.').map(Number)
      const p = new Date(r.date_time)
      return p.getFullYear() !== y || p.getMonth() + 1 !== m || p.getDate() !== d
    })
    expect(swapped.map((r) => r.date_time)).toEqual([])
  })

  test('the single month-first row is read as 23 Feb 2026, not rejected', () => {
    const i = dataLines.findIndex((l) => l.startsWith('2/23/2026'))
    expect(i).toBeGreaterThan(-1)
    const p = new Date(rows[i].date_time)
    expect([p.getFullYear(), p.getMonth() + 1, p.getDate()]).toEqual([2026, 2, 23])
  })

  // Payout is canonical; tokens x $0.025 is a separate comparison value.
  // The source data differs by $5.35 (not rounding), so they must never mix.
  test('payout, token value and source label stay distinct per row', () => {
    rows.forEach((r) => {
      expect(r.usd_source).toBe('payout')
      expect(milli(r.usd_from_tokens)).toBe(r.tokens * 25)
      expect(r.usd).not.toBe(undefined)
    })
    const diffMilli = rows.reduce((s, r) => s + milli(r.usd_from_tokens) - milli(r.usd), 0)
    expect(diffMilli).toBe(65900 - 60550) // $5.35
  })

  test('the reporting engine totals the payout ($60.55), never the token value', () => {
    const engine = aggregateRows(rows, 'UTC')
    expect(milli(engine.totalUSD)).toBe(60550)
    expect(milli(engine.totalUSD)).not.toBe(65900)
  })

  test('dates span the export', () => {
    const ms = rows.map((r) => new Date(r.date_time).getTime()).sort((a, b) => a - b)
    const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    expect(ymd(ms[0])).toBe('2024-12-29')
    expect(ymd(ms[ms.length - 1])).toBe('2026-02-23')
  })
})
