import { parseCSV } from '../analytics'

// Chaturbate multi-line paste: date line / action line / "tokens balance" line.
const paste = (date, tokLine) => `${date}\nTip From: alice\n${tokLine}\n`

describe('Chaturbate paste variants', () => {
  test('exact export format still parses (unchanged behaviour)', () => {
    const rows = parseCSV(paste('Nov 10, 2026, 10:05 PM', '25 25'), 'Chaturbate')
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens).toBe(25)
    expect(rows[0].date_time).toBe('2026-11-10 22:05:00')
  })

  test('missing comma after day/year is accepted', () => {
    expect(parseCSV(paste('Nov 10 2026, 10:05 PM', '25 25'), 'Chaturbate')).toHaveLength(1)
  })

  test('24-hour time without AM/PM is accepted', () => {
    const rows = parseCSV(paste('Nov 10, 2026, 22:05', '25 25'), 'Chaturbate')
    expect(rows).toHaveLength(1)
    expect(rows[0].date_time).toBe('2026-11-10 22:05:00')
  })

  test('full month name is accepted and dated correctly', () => {
    const rows = parseCSV(paste('November 10, 2026, 10:05 PM', '25 25'), 'Chaturbate')
    expect(rows).toHaveLength(1)
    expect(rows[0].date_time).toBe('2026-11-10 22:05:00')
  })

  test('tokens with thousands separators are accepted', () => {
    const rows = parseCSV(paste('Nov 10, 2026, 10:05 PM', '1,250 1,250'), 'Chaturbate')
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens).toBe(1250)
  })

  test('unknown month name is skipped, never silently dated January', () => {
    const rows = parseCSV(paste('Nxx 10, 2026, 10:05 PM', '25 25'), 'Chaturbate')
    expect(rows).toHaveLength(0)
  })
})
