/**
 * Import USD regression tests. Expected values come from an independent
 * oracle (integer token math in thousandths of a dollar), never from
 * production helpers.
 *
 * Bugs covered:
 *  - per-tip rounding to cents (1 BongaCams token stored as $0.03, so 40 tips = $1.20)
 *  - misread columns stored as earnings (tokens = 2026, payout $68,465)
 */
import { parseCSV, resolveRowUsd, USD_MISMATCH_FACTOR } from '../analytics'

// Oracle: model rate in thousandths of a dollar per token.
const MILLI_PER_TOKEN = { BongaCams: 25, Chaturbate: 50, MyFreeCams: 50, Unknown: 50 }
const oracleUsd = (tokens, platform) => (tokens * MILLI_PER_TOKEN[platform]) / 1000
const tab = (rows) => rows.map((r) => r.join('\t')).join('\n')

describe('resolveRowUsd', () => {
  test.each([
    ['BongaCams', 1], ['BongaCams', 40], ['BongaCams', 7], ['Chaturbate', 1], ['Chaturbate', 333], ['MyFreeCams', 100], ['Unknown', 9],
  ])('%s %i tokens with no payout = tokens x rate, unrounded', (platform, tokens) => {
    expect(resolveRowUsd(tokens, 0, platform)).toBe(oracleUsd(tokens, platform))
  })

  test('1 BongaCams token is $0.025, not rounded to $0.03 or $0.02', () => {
    expect(resolveRowUsd(1, 0, 'BongaCams')).toBe(0.025)
  })

  test('a real payout is kept at 4 decimals', () => {
    expect(resolveRowUsd(1, 0.0234567, 'BongaCams')).toBe(0.0235)
    expect(resolveRowUsd(16, 0.378, 'BongaCams')).toBe(0.378)
  })

  test('payout-only row (no tokens) keeps the payout', () => {
    expect(resolveRowUsd(0, 12.3456, 'BongaCams')).toBe(12.3456)
  })

  test('misread columns are rejected in both directions', () => {
    expect(USD_MISMATCH_FACTOR).toBe(5)
    expect(resolveRowUsd(2026, 68465, 'Chaturbate')).toBeNull() // year as tokens, ~676x
    expect(resolveRowUsd(1, 17262, 'Chaturbate')).toBeNull()
    expect(resolveRowUsd(1000, 1, 'Chaturbate')).toBeNull() // payout 50x too small
  })

  test('payouts within the factor are accepted', () => {
    expect(resolveRowUsd(30000, 1500, 'BongaCams')).toBe(1500) // 2x the base rate
  })
})

describe('parseCSV import totals', () => {
  test('40 one-token BongaCams tips with no payout column total exactly $1.00', () => {
    const rows = [['Date and Time', 'Member', 'Type', 'Tokens Earned']]
    for (let i = 0; i < 40; i++) rows.push([`18.06.2026 14:${String(i).padStart(2, '0')}`, `fan${i}`, 'Tips', '1'])
    const parsed = parseCSV(tab(rows), 'BongaCams')
    expect(parsed).toHaveLength(40)
    parsed.forEach((r) => expect(r.usd).toBe(0.025))
    const totalMilli = parsed.reduce((s, r) => s + Math.round(r.usd * 1000), 0)
    expect(totalMilli).toBe(40 * 25) // $1.000
    expect(Math.round(parsed.reduce((s, r) => s + r.usd, 0) * 100) / 100).toBe(1)
  })

  test('a misread row is dropped; valid rows in the same file survive', () => {
    const csv = tab([
      ['Date and Time', 'Member', 'Type', 'Tokens Earned', 'Your Payout'],
      ['18.06.2026 14:32', 'fanA', 'Tips', '10', '$0.24'],
      ['18.06.2026 14:33', 'fanB', 'Tips', '2026', '$68,465.00'],
      ['18.06.2026 14:34', 'fanC', 'Tips', '4', '$0.09'],
    ])
    const parsed = parseCSV(csv, 'BongaCams')
    expect(parsed.map((r) => r.username)).toEqual(['fana', 'fanc']) // usernames are lowercased on import
    expect(parsed.map((r) => r.usd)).toEqual([0.24, 0.09])
  })

  test('sub-cent payouts are stored unrounded, so the total matches the export', () => {
    const payouts = ['0.024', '0.024', '0.023', '0.023', '0.378']
    const csv = tab([
      ['Date and Time', 'Member', 'Type', 'Tokens Earned', 'Your Payout'],
      ...payouts.map((p, i) => [`13.09.2026 16:${10 + i}`, `u${i}`, 'Tips', i === 4 ? '16' : '1', `$${p}`]),
    ])
    const parsed = parseCSV(csv, 'BongaCams')
    const oracleMilli = payouts.reduce((s, p) => s + Math.round(Number(p) * 1000), 0) // 472
    expect(parsed.reduce((s, r) => s + Math.round(r.usd * 1000), 0)).toBe(oracleMilli)
  })
})
