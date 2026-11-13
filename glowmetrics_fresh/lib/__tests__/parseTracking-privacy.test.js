/**
 * Parse-failure diagnostics must describe a paste's STRUCTURE only: no fan
 * username, amount or text in any script may survive analyzeFormat().
 */
import { analyzeFormat } from '../parseTracking'

const PASTE = [
  'Date and Time\tMember\tType\tTokens Earned\tYour Payout',
  '18.06.2026 14:32\tSweetJohn99\tTips\t20\t$0.47',
  '18.06.2026 14:33\tДмитрий_Иванов\tTips\t5\t$0.12',
  '18.06.2026 14:34\tJosé_Muñoz\tTips\t1\t$0.02',
  '18.06.2026 14:35\t💎whale💎\tTips\t1000\t$23.50',
].join('\n')

describe('analyzeFormat privacy', () => {
  const out = analyzeFormat(PASTE)
  const blob = JSON.stringify(out)

  test.each(['SweetJohn', 'Дмитрий', 'Иванов', 'José', 'Muñoz', 'whale', '💎', '23.50', '0.47', 'Member', 'Payout'])(
    'does not contain %s', (s) => { expect(blob).not.toContain(s) })

  test('shapes contain only a, 9 and whitespace', () => {
    for (const entry of out.top_shapes) {
      const shape = entry.replace(/^\d+x /, '')
      expect(shape).toMatch(/^[a9\s]*$/)
    }
  })

  test('still describes the structure (line count, tabs, distinct shapes)', () => {
    expect(out.line_count).toBe(5)
    expect(out.has_tabs).toBe(true)
    expect(out.top_shapes.length).toBeGreaterThan(1)
  })
})
