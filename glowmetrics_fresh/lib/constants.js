// ============================================================
// CAMCASH — PLATFORM TOKEN RATES
// Single source of truth. Import tokenRate() from here.
// Never hardcode a platform rate anywhere else in the codebase.
// ============================================================

export const PLATFORM_TOKEN_RATES = {
  Chaturbate: 0.05,
  BongaCams:  0.025,
  MyFreeCams: 0.05,
  Stripchat:  0.05,
  CamSoda:    0.05,
}

export const DEFAULT_TOKEN_RATE = 0.05

// Lowercased lookup so callers passing DB/API casing (e.g. 'bongacams' from
// live_tips.platform) still resolve to the correct rate instead of silently
// falling through to DEFAULT_TOKEN_RATE.
const PLATFORM_TOKEN_RATES_LOWER = Object.fromEntries(
  Object.entries(PLATFORM_TOKEN_RATES).map(([k, v]) => [k.toLowerCase(), v])
)

export function tokenRate(platform) {
  if (!platform) return DEFAULT_TOKEN_RATE
  return PLATFORM_TOKEN_RATES_LOWER[platform.toLowerCase()] ?? DEFAULT_TOKEN_RATE
}

// What viewers pay per token to buy it (not what the model receives).
// Source: per-platform token calculators (e.g. camcalcs.com), checked July 2026.
export const PLATFORM_VIEWER_RATES = {
  Chaturbate: 0.10,
  BongaCams:  0.0682253,
  MyFreeCams: 0.0908909,
  Stripchat:  0.0925741,
  CamSoda:    0.1099,
}

export const DEFAULT_VIEWER_RATE = 0.10

export function viewerRate(platform) {
  return PLATFORM_VIEWER_RATES[platform] ?? DEFAULT_VIEWER_RATE
}

// Absolute lifetime-spend threshold for the "whale" label used by
// StreamPlanner's Whale Roster/Whale Watch and MoneyMap's Whales stat. Both
// hardcoded `500` independently before this constant existed.
//
// This is deliberately NOT the same concept as lib/analytics.js's
// identifyWhales() tiers (Whale/Shark/Regular/Dormant), which are RELATIVE —
// percentile ranks within a given creator's own fan base, so a creator's
// top-5% "Whale" may have spent far less than 500 tokens, and a creator with
// many big spenders may have dozens of 500+ fans who don't rank top-5%.
// Both answer real questions ("who are my biggest spenders in absolute
// terms?" vs "who are my top fans relative to my own base?"), and both
// surfaces label themselves accordingly ("Fans with 500+ tokens lifetime"
// / "500+ tokens lifetime" vs the tier badges). Keep them distinct; just
// don't duplicate the number.
export const WHALE_LIFETIME_TOKEN_THRESHOLD = 500

// The CSV parser's bucket for a row whose platform could not be detected
// (see detectPlatform()/parseCSV in lib/analytics.js). It is an ABSENCE of
// a platform, not a platform — so it must never be ranked as a creator's
// best or most profitable one. Kept here rather than as a scattered string
// literal so every consumer excludes the same value.
export const UNDETECTED_PLATFORM = 'Unknown'

// Canonical Creator Pro price label. The onboarding trial card and the
// pricing page must never retype this — a price that disagrees with Stripe
// in one place is worse than no price at all.
export const PRO_PRICE_MONTHLY_LABEL = '$19.99/mo'
