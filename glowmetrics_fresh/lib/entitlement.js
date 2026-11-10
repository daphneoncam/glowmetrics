// ============================================================
// CAMCASH — ENTITLEMENT READ (display only)
// The database decides who has Pro: public.entitlement_tier(), exposed to the
// signed-in user as get_my_entitlement() (caller-scoped, takes no user id).
// The browser never decides access; this only tells the UI what to show.
// Server-side enforcement (RPCs, RLS) calls the database rule directly.
// ============================================================

import { ENTITLEMENT_TIERS, isProPlan, tierHasPro } from './planLimits'

// Returns { tier, isPro, trialEndsAt, source }.
//   source 'server'   — the database answered.
//   source 'fallback' — the RPC failed or is not deployed yet: the UI keeps
//                       today's plan-column behaviour, so an RPC error can
//                       never lock a paying user out of what they had.
export async function fetchEntitlement(supabase, profile) {
  try {
    const { data, error } = await supabase.rpc('get_my_entitlement')
    const tier = data && typeof data === 'object' ? data.tier : null
    if (!error && ENTITLEMENT_TIERS.includes(tier)) {
      return {
        tier,
        isPro: tierHasPro(tier),
        trialEndsAt: tier === 'trial' ? (data.trial_ends_at ?? null) : null,
        source: 'server',
      }
    }
  } catch (_) { /* fall through to the plan-column fallback */ }
  return entitlementFromPlan(profile)
}

// Today's behaviour (profiles.plan), used only when the server cannot answer.
export function entitlementFromPlan(profile) {
  const isPro = isProPlan(profile?.plan)
  return { tier: isPro ? 'pro' : 'free', isPro, trialEndsAt: null, source: 'fallback' }
}
