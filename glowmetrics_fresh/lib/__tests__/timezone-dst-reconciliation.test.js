/**
 * Daylight-saving and midnight regression tests for the helpers that place
 * tips on a creator-local day, hour and weekday (Sessions: localDayKey;
 * Platforms: localParts; dashboard: zonedParts) and for session grouping.
 * Expected values are hand-computed from the published 2026 transitions:
 *   America/Los_Angeles: PST->PDT 2026-03-08 10:00Z, PDT->PST 2026-11-01 09:00Z
 *   Europe/London:       GMT->BST 2026-03-29 01:00Z, BST->GMT 2026-10-25 01:00Z
 */
import { localDayKey } from '../sessions/normalize'
import { localParts } from '../platformHistory'
import { zonedParts } from '../creatorTimezone'
import { detectSessions, SESSION_GAP_MS } from '../analytics/sessions'

const LA = 'America/Los_Angeles'
const LON = 'Europe/London'

describe('spring forward', () => {
  test('LA: 01:59 PST is followed by 03:00 PDT one minute later', () => {
    expect(localParts(Date.parse('2026-03-08T09:59:00Z'), LA)).toMatchObject({ date: '2026-03-08', hour: 1 })
    expect(localParts(Date.parse('2026-03-08T10:00:00Z'), LA)).toMatchObject({ date: '2026-03-08', hour: 3 })
    expect(zonedParts('2026-03-08T10:00:00Z', LA)).toMatchObject({ day: 8, hour: 3, minute: 0 })
  })

  test('London: 00:59 GMT is followed by 02:00 BST', () => {
    expect(localParts(Date.parse('2026-03-29T00:59:00Z'), LON).hour).toBe(0)
    expect(localParts(Date.parse('2026-03-29T01:00:00Z'), LON).hour).toBe(2)
  })
})

describe('fall back', () => {
  test('LA: 01:30 occurs twice (PDT then PST), both on Nov 1, hour 1', () => {
    for (const iso of ['2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z']) {
      expect(localParts(Date.parse(iso), LA)).toMatchObject({ date: '2026-11-01', hour: 1 })
      expect(localDayKey(iso, LA)).toBe('2026-11-01')
    }
  })

  test('tips 50 real minutes apart across fall-back stay one session even though the wall clock goes backwards', () => {
    // 01:40 PDT (08:40Z) then 01:30 PST (09:30Z): wall clock reads earlier, real gap is 50 min.
    const sessions = detectSessions([
      { date_time: '2026-11-01T08:40:00Z', platform: 'Chaturbate', username: 'a', tokens: 10, usd: 0.5 },
      { date_time: '2026-11-01T09:30:00Z', platform: 'Chaturbate', username: 'b', tokens: 10, usd: 0.5 },
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].durationMinutes).toBe(50)
  })
})

describe('creator-local midnight, weekday and UTC disagreement', () => {
  test('LA 23:59 Sunday Nov 1 is still Nov 1 locally though it is Nov 2 in UTC', () => {
    expect(localDayKey('2026-11-02T07:59:00Z', LA)).toBe('2026-11-01')
    expect(localDayKey('2026-11-02T08:00:00Z', LA)).toBe('2026-11-02')
    expect(localDayKey('2026-11-02T07:59:00Z', 'UTC')).toBe('2026-11-02')
  })

  test('weekday follows the creator zone (Sunday Nov 1 in LA, Monday in UTC)', () => {
    // platformHistory numbers Mon=0..Sun=6; creatorTimezone numbers Sun=0..Sat=6.
    expect(localParts(Date.parse('2026-11-02T07:59:00Z'), LA).weekday).toBe(6) // Sunday
    expect(localParts(Date.parse('2026-11-02T07:59:00Z'), 'UTC').weekday).toBe(0) // Monday
    expect(zonedParts('2026-11-02T07:59:00Z', LA).weekday).toBe(0) // Sunday
  })
})

describe('session gap boundary (60 minutes, inclusive)', () => {
  const tip = (iso, platform = 'Chaturbate') => ({ date_time: iso, platform, username: 'a', tokens: 10, usd: 0.5 })

  test('exactly 60 minutes apart: one session', () => {
    expect(SESSION_GAP_MS).toBe(3600000)
    expect(detectSessions([tip('2026-06-01T20:00:00Z'), tip('2026-06-01T21:00:00Z')])).toHaveLength(1)
  })

  test('60 minutes and 1 second apart: two sessions', () => {
    expect(detectSessions([tip('2026-06-01T20:00:00Z'), tip('2026-06-01T21:00:01Z')])).toHaveLength(2)
  })

  test('a session crossing creator-local midnight is not split by the date change', () => {
    const s = detectSessions([tip('2026-06-02T06:40:00Z'), tip('2026-06-02T07:20:00Z')]) // 23:40 -> 00:20 PDT
    expect(s).toHaveLength(1)
    expect(s[0].durationMinutes).toBe(40)
  })

  test('platform change starts a new session even inside the gap', () => {
    expect(detectSessions([tip('2026-06-01T20:00:00Z'), tip('2026-06-01T20:10:00Z', 'BongaCams')])).toHaveLength(2)
  })

  test('a tip with an unparseable timestamp is excluded, other tips keep their session', () => {
    const s = detectSessions([tip('2026-06-01T20:00:00Z'), tip('not a date'), tip('2026-06-01T20:30:00Z')])
    expect(s).toHaveLength(1)
    expect(s[0].tipCount).toBe(2)
  })
})
