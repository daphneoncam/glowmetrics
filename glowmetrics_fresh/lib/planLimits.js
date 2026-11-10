// ============================================================
// CAMCASH — PLAN LIMITS & FREEMIUM GATING
// Single source of truth for all Free vs Pro plan constants.
// ============================================================

// Platform connection limits (Free vs Pro)
// DB enforcer: supabase/migrations/20260910b_document_primary_and_streaming_platform_columns.sql
// Free tier allows 2 platforms; Pro allows unlimited.
export const FREE_PLATFORM_LIMIT = 2

// Analysis window for Free tier
// Free users see only the most recent 31 days per connected platform.
// Pro users see full historical data.
export const FREE_ANALYSIS_WINDOW_DAYS = 31

// ── Plan classification ──────────────────────────────────────────────────────
export function isProPlan(plan) {
  return plan === 'pro' || plan === 'unlimited'
}

// ── Platform role resolution ─────────────────────────────────────────────────
// THE single source of truth for primary-platform identity (Free history
// gating, Platform Intelligence, everything). Canonical field:
// profiles.primary_pro_platform, set only by POST /api/profile/primary-platform.
// It is NEVER inferred from streaming_platforms order, revenue, activity or
// earnings: primary_pro_platform NULL → primary null → on Free every platform
// stays on the 31-day window. streaming_platforms only supplies display order
// for the secondary list.
export function resolvePlatformRoles(streamingPlatforms, primaryProPlatform) {
  const list = Array.isArray(streamingPlatforms) ? streamingPlatforms.filter(Boolean) : []
  const primary = (primaryProPlatform && String(primaryProPlatform).trim()) || null
  const lower = primary ? String(primary).toLowerCase() : null
  const secondary = list.filter((p) => String(p).toLowerCase() !== lower)
  return { primary, secondary }
}

// ── User-facing error message ────────────────────────────────────────────────
// Single canonical string for all PLATFORM_LIMIT_REACHED surfaces.
// Used by: upload UI, API error responses, tooltip copy.
export function platformLimitMessage() {
  return `Free plan tracks ${FREE_PLATFORM_LIMIT} platforms. Upgrade to Pro to add more.`
}

// ── Module data thresholds ───────────────────────────────────────────────────
// Minimum data requirements to unlock each dashboard module.
// Never reimplement these thresholds locally in components.
export const MODULE_DATA_THRESHOLDS = {
  bestStreamingTimes: { tips: 25, sessions: 3 },
  avgHourlyRate: { sessions: 3, streamMinutes: 60 },
  topFans: { tips: 10, fans: 5 },
  whales: { fans: 10, earnings: 50 },
  sessionBreakdown: { sessions: 3 },
  moneyMap: { tips: 50, sessions: 5 },
  streamPlanner: { tips: 25, sessions: 3 },
  fanRecovery: { fans: 20, earnings: 50 },
  forecasting: { sessions: 8, earnings: 50 },
  liveScore: { liveModeSessions: 1 },
}
