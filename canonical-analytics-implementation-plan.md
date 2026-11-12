# Canonical Analytics — Implementation Plan (design only, not implemented)

Exact sequence and affected files/modules, per `canonical-analytics-rules.md`'s approved
architecture. No code written yet — this is the plan for review, per your explicit
instruction to wait for BUILD approval.

## Layer A — Canonical Analytics (pure calculations, no entitlement awareness)

| Step | Module | Action | Files affected |
|---|---|---|---|
| A1 | Sessions | No new code — `detectSessions()` is already canonical. Stream Planner stops calling `groupIntoSessions()` and consumes `analytics.sessions` (or a passed-in canonical session array) instead. | `app/dashboard/StreamPlanner.js` (remove `groupIntoSessions()`, `platformEfficiency()`'s session dependency); `lib/analytics/sessions.js` (unchanged) |
| A2 | Monthly growth | Extend `aggregateRows()`'s `monthlyData` to bucket by local calendar month (via `toLocalDateStr()`-derived key) instead of `getUTCFullYear()`/`getUTCMonth()`; add the growth-% field directly to its output. | `lib/analytics.js` (the `monthlyData`/`bestMonth` block) |
| A3 | Platforms | Extend `aggregateRows()`'s `platforms` output with per-platform `bestUtcDay`/`bestUtcHour`-equivalent (renamed to local-native, e.g. `bestLocalDay`/`bestLocalHour`), computed via the new Best-Times module (A4), not independently. | `lib/analytics.js` (the `platforms` block) |
| A4 | Best times | **New module** — a day×hour grid function operating on `meaningfulSessions` (not raw tips), median $/hour per bucket, local-native timezone, tagged with the four confidence tiers from the rules doc. This is the largest net-new piece of Layer A. | New: `lib/analytics/bestTimes.js` (or extend `lib/analytics.js` directly — implementation-time choice, not a decision needing your sign-off) |
| A5 | Missed revenue | **New module** — three functions/fields (`today_missed`, `cumulative_by_platform`, `recent_streak_missed`), each consuming A4's grid as input rather than recomputing best-hour. | New, alongside A4; retires `missedRevenueByPlatform` and `generateLossAlerts()`'s `peak_missed` branch |
| A6 | Fan intelligence | No calculation change — `identifyWhales()`, `generateWhaleAlerts()`, `generateLossAlerts()` (minus `peak_missed`) reused as-is. | `lib/analytics.js` (unchanged) |
| A7 | Recommendations | `generateNextMoves()` reused as-is, with its `bestHour` parameter repointed to A4's output instead of `computeBestTimes()`'s. | `lib/analytics.js` (one parameter source changes, not the function's logic) |
| A8 | Dead code removal | Delete `predictRevenue()` — confirmed zero consumers. | `lib/analytics.js` |

## Layer B — Server-Side Insight Service (orchestration)

| Step | Action | Files affected |
|---|---|---|
| B1 | New API route(s) or a set of Postgres functions that run Layer A server-side per authenticated request, scoped to `auth.uid()` (same ownership-check pattern already fixed in `get_user_insights` this session). One orchestration point per "screen's worth" of data (e.g. one call assembling everything Daily Brief needs, one for Opportunities, etc.) rather than one call per individual metric. | New: either `app/api/insights/*` routes calling into a server-side port of Layer A, or new SQL functions alongside `get_user_insights` |
| B2 | `get_user_insights` restructured internally to call B1's assembly logic instead of containing the calculation inline — existing callers (`app/dashboard/page.js`'s `engineInsights`) see no interface change. | `get_user_insights` (Postgres function body only — signature unchanged) |

## Layer C — Entitlement / Redaction

| Step | Action | Files affected |
|---|---|---|
| C1 | Build the shared redaction function per `entitlement-contract.md`'s approved shape — takes `(insight_type, full_result, is_pro)`, returns the `{unlocked, preview}` or `{unlocked, data}` shape. One implementation, called by every insight type, not duplicated per type (this is the gap `get_user_insights` currently has — it hand-codes its own redaction inline). | New: a shared module, either SQL (`public.redact_insight(...)`) or applied in B1's orchestration layer, whichever the implementer determines is more maintainable — not a decision requiring your sign-off |
| C2 | Apply C1 to every migrating consumer as it moves — Daily Brief first (already partially done via PR #407, needs repointing to A4 instead of its own SQL), then the rest per the migration order below. | Varies per consumer |

## Consumer migration order (restated from the rules doc, with exact files)

1. **Sessions (A1)** — `app/dashboard/StreamPlanner.js`. Lowest ambiguity, unblocks everything downstream that depends on session population.
2. **Monthly growth (A2)** — `app/dashboard/page.js` (retire the inline `_momThisRev`/`_momPrevRev` block, read `analytics.monthlyData` instead), `app/dashboard/DashboardGrowthCharts.js` (retire `monthlyUsdSeries()`'s own calc, consume the extended field).
3. **Best-times (A4) + Layer B/C for it** — the largest step. Consumers to repoint, in order of leak severity found in the audits: `app/dashboard/page.js`'s Sticky Command Bar and Smart Insights card (currently fully ungated — highest priority), the Daily Brief card itself (already gated, just needs to read the richer grid instead of `buildDailyBrief()`'s own calc), `app/dashboard/CreatorReport.js`'s Best Streaming Time stat card (currently ungated — per `creator-report-entitlement-spec.md`), `app/dashboard/StreamPlanner.js`'s week-table (currently CSS-blur gated — per `stream-planner-entitlement-spec.md`).
4. **Platform extension (A3)** — `lib/analytics.js`, then `app/dashboard/CreatorReport.js`'s Most Profitable Platform card (currently ungated $/hr).
5. **Missed revenue (A5)** — `app/dashboard/page.js`'s "You're Losing Money" card (currently fully ungated — the single highest-value leak found across every audit this session).
6. **Fan intelligence / churn (A6) + Layer C's aggregate-vs-full split** — same "Losing Money" card's alert section, plus `app/dashboard/page.js`'s `whales`/Top Fans tab.
7. **Recommendations (A7)** — `app/dashboard/CreatorReport.js`'s next-moves (retire the CSS-blur gate for a real server-side truncation).
8. **Dead code (A8)** — `lib/analytics.js`, zero-risk, any time.

## What is explicitly NOT in this plan

Live Mode's missing plan check (already separately approved/scoped, not part of this
analytics consolidation). Navigation/IA changes (separately approved, not started).
Opportunities page UI (depends on this plan completing first). Pricing/Stripe changes (none
proposed anywhere in this thread). UI redesign of Creator Report/Stream Planner (their
entitlement specs are written; visual redesign is a separate, later step).

## Testing gate before any consumer migrates

Per the rules doc: fixtures for a whale-heavy account, a sparse (<10-tip) account, an
exactly-at-threshold account, a platform-switching account, a midnight-crossing session, and a
DST-transition account — each canonical function (A1–A8) gets a fixture-driven test asserting
exact expected output before step 3 onward begins, since that's where visible numbers start
changing for real users.

---
No code changed. No PR created. Plan only — waiting for explicit BUILD approval.
