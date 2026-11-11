import { hasDashboardAccess, PAYWALL_TEST_CUTOFF } from '../paywallTest'

const NEW_USER = '2026-11-20T10:00:00Z'      // created after the cutoff
const LEGACY_USER = '2026-10-01T10:00:00Z'   // created before the cutoff
const NOW = new Date('2026-11-25T12:00:00Z')

describe('paywall test: dashboard access rule', () => {
  test('cutoff is the agreed test start', () => {
    expect(PAYWALL_TEST_CUTOFF).toBe('2026-11-11T00:00:00Z')
  })

  test('new user with no profile, no trial, no payment is denied', () => {
    expect(hasDashboardAccess({ profile: null, userCreatedAt: NEW_USER }, NOW)).toBe(false)
    expect(hasDashboardAccess({ profile: { plan: 'free', subscription_status: 'none' }, userCreatedAt: NEW_USER }, NOW)).toBe(false)
  })

  test('new user with an active paid subscription is allowed', () => {
    expect(hasDashboardAccess({ profile: { plan: 'pro', subscription_status: 'active' }, userCreatedAt: NEW_USER }, NOW)).toBe(true)
  })

  test('unlimited plan is allowed', () => {
    expect(hasDashboardAccess({ profile: { plan: 'unlimited', subscription_status: null }, userCreatedAt: NEW_USER }, NOW)).toBe(true)
  })

  test('new user on a valid free trial is allowed until the trial ends', () => {
    const profile = { plan: 'free', subscription_status: 'trialing', trial_ends_at: '2026-11-30T00:00:00Z' }
    expect(hasDashboardAccess({ profile, userCreatedAt: NEW_USER }, NOW)).toBe(true)
  })

  test('an expired trial is denied', () => {
    const profile = { plan: 'free', subscription_status: 'trialing', trial_ends_at: '2026-11-20T00:00:00Z' }
    expect(hasDashboardAccess({ profile, userCreatedAt: NEW_USER }, NOW)).toBe(false)
  })

  test('a past-due or canceled subscription with no paid plan is denied', () => {
    expect(hasDashboardAccess({ profile: { plan: 'free', subscription_status: 'past_due' }, userCreatedAt: NEW_USER }, NOW)).toBe(false)
    expect(hasDashboardAccess({ profile: { plan: 'free', subscription_status: 'canceled' }, userCreatedAt: NEW_USER }, NOW)).toBe(false)
  })

  test('a failed payment never unlocks access on its own', () => {
    expect(hasDashboardAccess({ profile: { plan: 'free', subscription_status: 'incomplete' }, userCreatedAt: NEW_USER }, NOW)).toBe(false)
  })

  test('existing users keep access regardless of plan or billing state', () => {
    expect(hasDashboardAccess({ profile: { plan: 'free', subscription_status: 'none' }, userCreatedAt: LEGACY_USER }, NOW)).toBe(true)
    expect(hasDashboardAccess({ profile: null, userCreatedAt: LEGACY_USER }, NOW)).toBe(true)
  })

  test('a user created exactly at the cutoff is treated as new', () => {
    expect(hasDashboardAccess({ profile: null, userCreatedAt: PAYWALL_TEST_CUTOFF }, NOW)).toBe(false)
  })

  test('missing or invalid created_at does not grant legacy access', () => {
    expect(hasDashboardAccess({ profile: null, userCreatedAt: undefined }, NOW)).toBe(false)
    expect(hasDashboardAccess({ profile: null, userCreatedAt: 'not-a-date' }, NOW)).toBe(false)
  })
})
