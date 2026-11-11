// ============================================================
// CAMCASH — TEMPORARY PAYWALL TEST (dashboard access rule)
// Single source of truth for the test. To switch back to the legacy
// onboarding/pricing behaviour, set PAYWALL_TEST_ENABLED to false.
// Legacy snapshot: git tag `legacyonboarding` (branch `legacyonboarding`).
// ============================================================

export const PAYWALL_TEST_ENABLED = true

// Accounts created before this instant keep full dashboard access
// (imports, exports, live mode allowance, existing data).
export const PAYWALL_TEST_CUTOFF = '2026-11-11T00:00:00Z'

// Trial length offered when the user chooses the free trial (card required).
export const PAYWALL_TRIAL_DAYS = 7

const PAID_PLANS = ['pro', 'unlimited']

// Decides whether a user may open the dashboard.
//   profile:       { plan, subscription_status, trial_ends_at } from profiles, or null
//   userCreatedAt: the Supabase auth user's created_at (ISO string)
//   now:           injectable clock for tests
export function hasDashboardAccess({ profile, userCreatedAt } = {}, now = new Date()) {
  if (!PAYWALL_TEST_ENABLED) return true

  // Existing users keep access to their data during the test.
  const created = userCreatedAt ? new Date(userCreatedAt) : null
  if (created && !Number.isNaN(created.getTime()) && created < new Date(PAYWALL_TEST_CUTOFF)) return true

  if (!profile) return false

  // Paid: plan is only set to 'pro' by the webhook when the subscription is active.
  if (PAID_PLANS.includes(profile.plan)) return true

  // Free trial: Stripe trial in progress (card on file) and not yet ended.
  if (profile.subscription_status === 'trialing') {
    if (!profile.trial_ends_at) return true
    const end = new Date(profile.trial_ends_at)
    return !Number.isNaN(end.getTime()) && end > now
  }

  return false
}
