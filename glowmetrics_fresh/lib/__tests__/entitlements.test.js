import {
  ACCESS_STATES, accessStateFromSubscription, hasAccess, historyWindowDays, platformLimit,
  TRIAL_HISTORY_WINDOW_DAYS, LEGACY_PLATFORM_LIMIT,
} from '../entitlements'

const NOW = new Date('2026-11-20T12:00:00Z')
const ts = (d) => Math.floor(new Date(d).getTime() / 1000)
const sub = (over = {}, interval = 'month') => ({
  status: 'active',
  cancel_at_period_end: false,
  current_period_end: ts('2026-12-01T00:00:00Z'),
  items: { data: [{ price: { recurring: { interval } } }] },
  ...over,
})

describe('Stripe status → access state', () => {
  test('trialing with a future trial end is trial access', () => {
    expect(accessStateFromSubscription(sub({ status: 'trialing', trial_end: ts('2026-11-27T00:00:00Z') }), NOW)).toBe(ACCESS_STATES.TRIAL)
  })
  test('trialing whose trial end has passed is expired', () => {
    expect(accessStateFromSubscription(sub({ status: 'trialing', trial_end: ts('2026-11-10T00:00:00Z') }), NOW)).toBe(ACCESS_STATES.EXPIRED)
  })
  test('active monthly is paid_monthly; active yearly is paid_annual (identical access)', () => {
    expect(accessStateFromSubscription(sub({}, 'month'), NOW)).toBe(ACCESS_STATES.PAID_MONTHLY)
    expect(accessStateFromSubscription(sub({}, 'year'), NOW)).toBe(ACCESS_STATES.PAID_ANNUAL)
  })
  test('cancel at period end keeps paid access until the period end, then expires', () => {
    expect(accessStateFromSubscription(sub({ cancel_at_period_end: true }), NOW)).toBe(ACCESS_STATES.PAID_MONTHLY)
    expect(accessStateFromSubscription(sub({ cancel_at_period_end: true, current_period_end: ts('2026-11-15T00:00:00Z') }), NOW)).toBe(ACCESS_STATES.EXPIRED)
  })
  test('past_due keeps access for the 3-day grace period, then no access', () => {
    expect(accessStateFromSubscription(sub({ status: 'past_due', current_period_end: ts('2026-11-19T00:00:00Z') }), NOW)).toBe(ACCESS_STATES.PAID_MONTHLY)
    expect(accessStateFromSubscription(sub({ status: 'past_due', current_period_end: ts('2026-11-10T00:00:00Z') }), NOW)).toBe(ACCESS_STATES.PAST_DUE)
  })
  test('canceled is canceled; unpaid is expired', () => {
    expect(accessStateFromSubscription(sub({ status: 'canceled' }), NOW)).toBe(ACCESS_STATES.CANCELED)
    expect(accessStateFromSubscription(sub({ status: 'unpaid' }), NOW)).toBe(ACCESS_STATES.EXPIRED)
  })
  test('incomplete and incomplete_expired grant nothing', () => {
    expect(accessStateFromSubscription(sub({ status: 'incomplete' }), NOW)).toBe(ACCESS_STATES.NONE)
    expect(accessStateFromSubscription(sub({ status: 'incomplete_expired' }), NOW)).toBe(ACCESS_STATES.NONE)
  })
  test('no subscription object grants nothing', () => {
    expect(accessStateFromSubscription(null, NOW)).toBe(ACCESS_STATES.NONE)
  })
})

describe('entitlements per state', () => {
  test('access: trial, monthly and annual paid, and legacy have access; none, canceled, expired, past_due do not', () => {
    for (const s of [ACCESS_STATES.TRIAL, ACCESS_STATES.PAID_MONTHLY, ACCESS_STATES.PAID_ANNUAL, ACCESS_STATES.LEGACY]) expect(hasAccess(s)).toBe(true)
    for (const s of [ACCESS_STATES.NONE, ACCESS_STATES.CANCELED, ACCESS_STATES.EXPIRED, ACCESS_STATES.PAST_DUE]) expect(hasAccess(s)).toBe(false)
  })
  test('trial history is the rolling 31-day window; paid and legacy are unlimited', () => {
    expect(historyWindowDays(ACCESS_STATES.TRIAL)).toBe(TRIAL_HISTORY_WINDOW_DAYS)
    expect(TRIAL_HISTORY_WINDOW_DAYS).toBe(31)
    expect(historyWindowDays(ACCESS_STATES.PAID_MONTHLY)).toBeNull()
    expect(historyWindowDays(ACCESS_STATES.PAID_ANNUAL)).toBeNull()
    expect(historyWindowDays(ACCESS_STATES.LEGACY)).toBeNull()
  })
  test('platform cap: trial and paid are unlimited; only legacy keeps the cap of 3', () => {
    expect(platformLimit(ACCESS_STATES.TRIAL)).toBeNull()
    expect(platformLimit(ACCESS_STATES.PAID_MONTHLY)).toBeNull()
    expect(platformLimit(ACCESS_STATES.PAID_ANNUAL)).toBeNull()
    expect(platformLimit(ACCESS_STATES.LEGACY)).toBe(LEGACY_PLATFORM_LIMIT)
    expect(LEGACY_PLATFORM_LIMIT).toBe(3)
  })
})
