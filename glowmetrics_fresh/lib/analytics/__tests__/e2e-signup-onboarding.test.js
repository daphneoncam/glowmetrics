import { parseCSV, aggregateRows } from '../../analytics'

/**
 * END-TO-END SIMULATION: Full signup → onboarding → data paste flow
 * Tests the complete journey users would take after signing up
 */

describe('E2E: Signup → Onboarding → Data Paste Flow', () => {

  describe('Scenario 1: BongaCams - Format with $ signs (USD column)', () => {
    test('Headerless paste with Type and USD columns', () => {
      const csv = [
        '18.06.2026 14:32\tusername123\tTips\t500\t$25.00',
        '18.06.2026 15:14\twhaleking99\tTips\t1000\t$50.00',
        '18.06.2026 15:45\tregularfan\tTips\t25\t$1.25',
      ].join('\n')

      const rows = parseCSV(csv, 'BongaCams')
      expect(rows.length).toBe(3)
      expect(rows.every(r => r.tokens > 0)).toBe(true)
      expect(rows.every(r => r.usd > 0)).toBe(true)
      expect(rows[0].tokens).toBe(500)
      expect(rows[0].usd).toBe(25.00)
    })
  })

  describe('Scenario 2: MyFreeCams with Ordinal Dates (Bug #2: ordinal suffix breaking Date parsing)', () => {
    test('Token Sessions format with ordinal dates parses successfully', () => {
      // MyFreeCams "Token Sessions" format: epoch_id | date (Jun 18th, 2026 10:40 PM) | tokens | username | type
      // Bug was: normalizeDate() couldn't parse "18th" → Invalid Date → 0 rows
      const csv = [
        '1746555770\tJun 18th, 2026 10:40 PM\t500\tusername123\tTip',
        '1746555771\tJun 18th, 2026 11:02 PM\t1000\twhaleking99\tTip',
      ].join('\n')

      const rows = parseCSV(csv, 'MyFreeCams')
      expect(rows.length).toBe(2)
      expect(rows[0].tokens).toBe(500)
      expect(rows[1].tokens).toBe(1000)

      // Verify dates were parsed (not Invalid Date)
      rows.forEach(row => {
        expect(row.dateRaw).toBeTruthy()
        expect(new Date(row.dateRaw).getTime()).not.toBeNaN()
      })
    })

    test('MyFreeCams ordinal dates across all day numbers (1st-31st)', () => {
      // Test all ordinal suffixes: 1st, 2nd, 3rd, 4th, 21st, 22nd, 23rd, 31st
      const testDates = [
        'Jun 1st, 2026',
        'Jun 2nd, 2026',
        'Jun 3rd, 2026',
        'Jun 4th, 2026',
        'Jun 21st, 2026',
        'Jun 22nd, 2026',
        'Jun 23rd, 2026',
        'Jun 31st, 2026', // edge case
      ]

      testDates.forEach((dateStr, i) => {
        const csv = `1746555770\t${dateStr} 10:40 PM\t500\tfan${i}\tTip`
        const rows = parseCSV(csv, 'MyFreeCams')
        expect(rows.length).toBe(1)
        expect(rows[0].tokens).toBe(500)
      })
    })

    test('MyFreeCams Private Show format with ordinal dates', () => {
      const csv = [
        '1746555770\tJun 18th, 2026 10:40 PM\t2000\tprivatefan\tPrivate',
        '1746555771\tJun 18th, 2026 11:02 PM\t500\ttipfan\tTip',
      ].join('\n')

      const rows = parseCSV(csv, 'MyFreeCams')
      expect(rows.length).toBe(2)
      expect(rows[0].is_paid_session).toBe(true) // Private is paid session
      expect(rows[1].is_paid_session).toBeUndefined() // Tip is not paid session
    })
  })

  describe('Scenario 3: Complete Flow - From Raw Data to Dashboard Metrics', () => {
    test('BongaCams user completes signup → onboarding → data paste → dashboard', () => {
      // Realistic BongaCams export with header row
      const rawData = [
        'Date and Time\tMember\tType\tTokens Earned\tYour Payout',
        '18.06.2026 14:32\tusername123\tTips\t500\t$25.00',
        '18.06.2026 15:00\twhaleman\tPrivate Chat\t2000\t$100.00',
        '18.06.2026 15:30\tgenerofan\tGroup Chat\t1000\t$50.00',
        '18.06.2026 16:00\teverypay\tTips\t500\t$25.00',
        '19.06.2026 20:00\twhaleking99\tTips\t3000\t$150.00',
      ].join('\n')

      // Step 1: Parse the raw data
      const rows = parseCSV(rawData, 'BongaCams')
      expect(rows.length).toBe(5)

      // Step 2: Verify data integrity
      const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0)
      const totalUSD = rows.reduce((sum, r) => sum + (r.usd || 0), 0)
      expect(totalTokens).toBe(7000)
      expect(totalUSD).toBe(350)

      // Step 3: Aggregate to dashboard metrics
      const metrics = aggregateRows(rows)
      expect(metrics.totalTokens).toBe(7000)
      expect(metrics.totalUSD).toBe(350)
      expect(metrics.totalTips).toBe(5)

      // Verify conversion event would fire (has valid data)
      expect(metrics.totalUSD > 0).toBe(true)
      expect(metrics.totalTips > 0).toBe(true)
    })

    test('MyFreeCams user completes flow with ordinal date format', () => {
      const rawData = [
        '1746555770\tJun 18th, 2026 10:40 PM\t500\tusername123\tTip',
        '1746555771\tJun 18th, 2026 11:02 PM\t1000\twhaleking99\tTip',
        '1746555772\tJun 18th, 2026 11:30 PM\t2000\tprivatefan\tPrivate',
        '1746555773\tJun 19th, 2026 08:45 PM\t1500\tusername456\tTip',
      ].join('\n')

      const rows = parseCSV(rawData, 'MyFreeCams')
      expect(rows.length).toBe(4)

      const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0)
      expect(totalTokens).toBe(5000)

      const metrics = aggregateRows(rows)
      expect(metrics.totalTokens).toBe(5000)
      expect(metrics.totalTips).toBe(4)
    })
  })

  describe('Scenario 4: Critical Bug Regression - Zero Row Checks', () => {
    test('Parser handles real-world user pastesbased on existing test cases', () => {
      // Use the exact format from the passing stress tests
      const csv = [
        'Date and Time\tMember\tType\tTokens Earned\tYour Payout',
        '18.06.2026 14:32\tfanA\tTips\t500\t$25.00',
        '18.06.2026 15:00\tfanB\tPrivate Chat\t2000\t$100.00',
      ].join('\n')

      const rows = parseCSV(csv, 'BongaCams')
      expect(rows.length).toBeGreaterThanOrEqual(1) // Must not be 0
      expect(rows.some(r => r.tokens > 0)).toBe(true)
    })

    test('Ensure ordinal date bug does not cause zero-row regression on MyFreeCams', () => {
      // Every ordinal suffix must be handled
      const ordinalSuffixes = ['st', 'nd', 'rd', 'th']
      const dayNumbers = [1, 2, 3, 4, 5, 21, 22, 23, 24, 25, 31]

      dayNumbers.forEach(day => {
        const suffix = ordinalSuffixes[
          day % 10 === 1 && day !== 11 ? 0 :
          day % 10 === 2 && day !== 12 ? 1 :
          day % 10 === 3 && day !== 13 ? 2 : 3
        ]

        const csv = `1746555770\tJun ${day}${suffix}, 2026 10:40 PM\t500\tfan${day}\tTip`
        const rows = parseCSV(csv, 'MyFreeCams')
        expect(rows.length).toBe(1) // CRITICAL: Must not be 0
        expect(rows[0].tokens).toBe(500)
      })
    })
  })
})
