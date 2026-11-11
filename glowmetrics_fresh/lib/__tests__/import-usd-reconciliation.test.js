/**
 * Import USD regression tests. Every expected value comes from an independent
 * oracle (integer math in thousandths of a dollar, or the literal payout in
 * the fixture), never from production helpers.
 *
 * Bugs covered:
 *  - per-tip rounding to cents (1 BongaCams token stored as $0.03, so 40 tips = $1.20)
 *  - misread columns stored as earnings (tokens = 2026, payout $68,465)
 *  - 'Unknown' platform silently priced at another platform's $0.05 rate
 */
import { parseCSV, resolveRowUsd, resolveRowUsdDetail, USD_MISMATCH_FACTOR, aggregateRows } from '../analytics'

// Oracle: model rate in thousandths of a dollar per token, known platforms only.
const MILLI_PER_TOKEN = { BongaCams: 25, Chaturbate: 50, MyFreeCams: 50 }
const oracleUsd = (tokens, platform) => (tokens * MILLI_PER_TOKEN[platform]) / 1000
const milli = (usd) => Math.round(usd * 1000)
const tab = (rows) => rows.map((r) => r.join('\t')).join('\n')
const BC_HEADER = ['Date and Time', 'Member', 'Type', 'Tokens Earned', 'Your Payout']

describe('resolveRowUsdDetail: payout and token value are kept separately', () => {
  test.each([
    ['BongaCams', 1], ['BongaCams', 40], ['BongaCams', 7], ['Chaturbate', 1], ['Chaturbate', 333], ['MyFreeCams', 100],
  ])('%s %i tokens, no payout: tokens x rate, unrounded, source tokens', (platform, tokens) => {
    const d = resolveRowUsdDetail(tokens, 0, platform)
    expect(d).toEqual({ usd: oracleUsd(tokens, platform), source: 'tokens', usdFromTokens: oracleUsd(tokens, platform) })
  })

  test('1 BongaCams token is $0.025, not rounded to $0.03 or $0.02', () => {
    expect(resolveRowUsd(1, 0, 'BongaCams')).toBe(0.025)
  })

  test('an actual payout is kept (4 dp) and the token value is reported beside it', () => {
    expect(resolveRowUsdDetail(1, 0.0234567, 'BongaCams')).toEqual({ usd: 0.0235, source: 'payout', usdFromTokens: 0.025 })
    expect(resolveRowUsdDetail(16, 0.378, 'BongaCams')).toEqual({ usd: 0.378, source: 'payout', usdFromTokens: 0.4 })
  })

  test('payout-only row (no tokens) keeps the payout', () => {
    expect(resolveRowUsdDetail(0, 12.3456, 'BongaCams')).toEqual({ usd: 12.3456, source: 'payout', usdFromTokens: null })
  })

  test('zero tokens and zero payout: no earnings, source none', () => {
    expect(resolveRowUsdDetail(0, 0, 'BongaCams')).toEqual({ usd: 0, source: 'none', usdFromTokens: null })
  })

  test('large legitimate tips are accepted', () => {
    expect(resolveRowUsd(100000, 2360, 'BongaCams')).toBe(2360) // 0.0236/token, real BongaCams payout level
    expect(resolveRowUsd(50000, 0, 'Chaturbate')).toBe(oracleUsd(50000, 'Chaturbate')) // $2,500
    expect(resolveRowUsd(30000, 1500, 'BongaCams')).toBe(1500) // 2x the base rate, inside the factor
  })
})

describe('Unknown platform: no rate is invented', () => {
  test.each(['Unknown', 'SomeNewSite', '', null])('tokens only on %p: unresolved, usd 0, no token value', (platform) => {
    expect(resolveRowUsdDetail(9, 0, platform)).toEqual({ usd: 0, source: 'unresolved', usdFromTokens: null })
  })

  test('actual payout on an Unknown platform is preserved and never range-checked', () => {
    expect(resolveRowUsdDetail(2026, 68465, 'Unknown')).toEqual({ usd: 68465, source: 'payout', usdFromTokens: null })
  })

  test('platform aliases resolve to their real rate', () => {
    expect(resolveRowUsdDetail(40, 0, 'BC')).toEqual({ usd: 1, source: 'tokens', usdFromTokens: 1 })
  })
})

describe('5x misread-column rule', () => {
  test('the factor is 5', () => expect(USD_MISMATCH_FACTOR).toBe(5))

  test('rejects payouts far above tokens x rate (year as tokens, id as payout)', () => {
    expect(resolveRowUsdDetail(2026, 68465, 'Chaturbate').source).toBe('rejected')
    expect(resolveRowUsdDetail(1, 17262, 'Chaturbate').source).toBe('rejected')
  })

  test('rejects payouts far below tokens x rate', () => {
    expect(resolveRowUsdDetail(1000, 1, 'Chaturbate').source).toBe('rejected') // 50x too small
  })

  test('boundary: exactly 5x is accepted, just over is rejected', () => {
    expect(resolveRowUsdDetail(100, 25, 'Chaturbate').source).toBe('payout') // tokens value $5, payout 5x
    expect(resolveRowUsdDetail(100, 25.01, 'Chaturbate').source).toBe('rejected')
    expect(resolveRowUsdDetail(100, 1, 'Chaturbate').source).toBe('payout') // exactly 1/5
    expect(resolveRowUsdDetail(100, 0.99, 'Chaturbate').source).toBe('rejected')
  })
})

describe('parseCSV: formats, columns and audit fields', () => {
  test('40 one-token BongaCams tips with no payout column total exactly $1.00', () => {
    const rows = [['Date and Time', 'Member', 'Type', 'Tokens Earned']]
    for (let i = 0; i < 40; i++) rows.push([`18.06.2026 14:${String(i).padStart(2, '0')}`, `fan${i}`, 'Tips', '1'])
    const parsed = parseCSV(tab(rows), 'BongaCams')
    expect(parsed).toHaveLength(40)
    parsed.forEach((r) => { expect(r.usd).toBe(0.025); expect(r.usd_source).toBe('tokens') })
    expect(parsed.reduce((s, r) => s + milli(r.usd), 0)).toBe(40 * 25) // $1.000
  })

  test('payout column present: payouts kept, token value carried for audit', () => {
    const parsed = parseCSV(tab([BC_HEADER, ['18.06.2026 14:32', 'fanA', 'Tips', '20', '$0.78']]), 'BongaCams')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ tokens: 20, usd: 0.78, usd_source: 'payout', usd_from_tokens: 0.5 })
  })

  test('missing token column: payout kept, tokens implied at the platform rate', () => {
    const parsed = parseCSV(tab([['Date and Time', 'Member', 'Type', 'Your Payout'], ['18.06.2026 14:32', 'fanA', 'Tips', '$1.00']]), 'BongaCams')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ usd: 1, usd_source: 'payout', tokens: 40 })
  })

  test('a misread row is dropped; valid rows in the same file survive', () => {
    const parsed = parseCSV(tab([
      BC_HEADER,
      ['18.06.2026 14:32', 'fanA', 'Tips', '10', '$0.24'],
      ['18.06.2026 14:33', 'fanB', 'Tips', '2026', '$68,465.00'],
      ['18.06.2026 14:34', 'fanC', 'Tips', '4', '$0.09'],
    ]), 'BongaCams')
    expect(parsed.map((r) => r.username)).toEqual(['fana', 'fanc']) // usernames are lowercased on import
    expect(parsed.map((r) => r.usd)).toEqual([0.24, 0.09])
  })

  test('zero-token, zero-payout rows are not imported', () => {
    const parsed = parseCSV(tab([BC_HEADER, ['18.06.2026 14:32', 'fanA', 'Tips', '0', '$0.00'], ['18.06.2026 14:33', 'fanB', 'Tips', '2', '$0.05']]), 'BongaCams')
    expect(parsed.map((r) => r.username)).toEqual(['fanb'])
  })

  test('refund and negative rows are never imported as earnings', () => {
    const parsed = parseCSV(tab([
      BC_HEADER,
      ['18.06.2026 14:32', 'fanA', 'Refund', '10', '$0.24'],
      ['18.06.2026 14:33', 'fanB', 'Tips', '-10', '-$0.24'],
      ['18.06.2026 14:34', 'fanC', 'Tips', '10', '$0.24'],
    ]), 'BongaCams')
    expect(parsed.map((r) => r.username)).toEqual(['fanc'])
    expect(parsed.reduce((s, r) => s + milli(r.usd), 0)).toBe(240)
  })

  test('sub-cent payouts are stored unrounded, so the total matches the export', () => {
    const payouts = ['0.024', '0.024', '0.023', '0.023', '0.378']
    const parsed = parseCSV(tab([
      BC_HEADER,
      ...payouts.map((p, i) => [`13.09.2026 16:${10 + i}`, `u${i}`, 'Tips', i === 4 ? '16' : '1', `$${p}`]),
    ]), 'BongaCams')
    const oracleMilli = payouts.reduce((s, p) => s + milli(Number(p)), 0) // 472
    expect(parsed.reduce((s, r) => s + milli(r.usd), 0)).toBe(oracleMilli)
  })
})

describe('4-decimal precision survives aggregation', () => {
  test('1,000 one-token BongaCams tips aggregate to $25.00, not $30.00', () => {
    const rows = [['Date and Time', 'Member', 'Type', 'Tokens Earned']]
    for (let i = 0; i < 1000; i++) {
      const d = 1 + Math.floor(i / 100), h = Math.floor((i % 100) / 10), m = (i % 10) * 5
      rows.push([`${String(d).padStart(2, '0')}.06.2026 ${String(10 + h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, `fan${i % 37}`, 'Tips', '1'])
    }
    const parsed = parseCSV(tab(rows), 'BongaCams')
    expect(parsed).toHaveLength(1000)
    expect(parsed.reduce((s, r) => s + milli(r.usd), 0)).toBe(1000 * 25)
    const engine = aggregateRows(parsed, 'UTC')
    expect(engine.totalUSD).toBe(25)
  })
})
