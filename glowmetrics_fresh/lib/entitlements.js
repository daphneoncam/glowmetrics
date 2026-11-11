// ============================================================
// CAMCASH — ENTITLEMENTS (billing state → product access)
// Billing state and product entitlements are separate. `plan = 'free'` is
// NOT used to decide trial or paid access. Decisions:
//   - Trial: all platforms, full features, rolling 31-day history.
//   - Monthly and annual paid: identical entitlements, full history.
//   - Legacy: accounts created before the cutoff keep current behaviour
//     (grandfathered; not a Free tier; no migration here).
// The webhook derives `access_state` from the Stripe subscription object.
// ============================================================

export const ACCESS_STATES = Object.freeze({
  LEGACY: 'legacy',
  TRIAL: 'trial',
  PAID_MONTHLY: 'paid_monthly',
  PAID_ANNUAL: 'paid_annual',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
  NONE: 'none',
})

export const TRIAL_HISTORY_WINDOW_DAYS = 31
export const PAST_DUE_GRACE_DAYS = 3

// Stripe subscription status → access state.
// `sub` is the Stripe subscription object (status, current_period_end,
// cancel_at_period_end, items.data[0].price.recurring.interval, ...).
// `now` is injectable for tests.
export function accessStateFromSubscription(sub, now = new Date()) {
  if (!sub || typeof sub !== 'object') return ACCESS_STATES.NONE
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval || sub.plan?.interval || null
  const paidState = interval === 'year' ? ACCESS_STATES.PAID_ANNUAL : ACCESS_STATES.PAID_MONTHLY

  switch (sub.status) {
    case 'trialing': {
      const end = sub.trial_end ? new Date(sub.trial_end * 1000) : null
      if (end && end <= now) return ACCESS_STATES.EXPIRED
      return ACCESS_STATES.TRIAL
    }
    case 'active': {
      // Cancelled at period end: paid through the period end.
      if (sub.cancel_at_period_end && sub.current_period_end) {
        const end = new Date(sub.current_period_end * 1000)
        if (end <= now) return ACCESS_STATES.EXPIRED
      }
      return paidState
    }
    case 'past_due': {
      // Grace: access continues for PAST_DUE_GRACE_DAYS after the period end.
      const end = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null
      if (end) {
        const graceEnd = new Date(end.getTime() + PAST_DUE_GRACE_DAYS * 86400000)
        if (now < graceEnd) return paidState
      }
      return ACCESS_STATES.PAST_DUE
    }
    case 'canceled':
      return ACCESS_STATES.CANCELED
    case 'unpaid':
      return ACCESS_STATES.EXPIRED
    case 'incomplete':
    case 'incomplete_expired':
      return ACCESS_STATES.NONE
    default:
      return ACCESS_STATES.NONE
  }
}

// Whether a state grants dashboard access.
export function hasAccess(state) {
  return state === ACCESS_STATES.LEGACY
    || state === ACCESS_STATES.TRIAL
    || state === ACCESS_STATES.PAID_MONTHLY
    || state === ACCESS_STATES.PAID_ANNUAL
}

// History visibility: null = unlimited, otherwise rolling days.
export function historyWindowDays(state) {
  return state === ACCESS_STATES.TRIAL ? TRIAL_HISTORY_WINDOW_DAYS : null
}

// Platform cap: null = unlimited. Only legacy free rows keep the old cap (3).
export const LEGACY_PLATFORM_LIMIT = 3
export function platformLimit(state) {
  return state === ACCESS_STATES.LEGACY ? LEGACY_PLATFORM_LIMIT : null
}
