# Analytics Duplication Map

Every confirmed duplicate calculation, with the actual business-rule comparison requested —
not an assumption that duplicates agree. No code changed.

## 1. Session detection — CONFIRMED RULE CONFLICT, not just redundancy

| | `detectSessions()` | `groupIntoSessions()` |
|---|---|---|
| File | `lib/analytics/sessions.js` | `app/dashboard/StreamPlanner.js` (49–79) |
| Purpose | Canonical session inference from tip timestamps | Local session inference for the scheduling engine |
| Inputs | `tips` | `tips` |
| Gap rule | **3-hour gap** | **4-hour gap** |
| Platform-boundary rule | **A platform change always starts a new session**, even within the gap window | **No platform boundary — a session can span multiple platforms**, with a "primary platform" assigned after the fact by tip-count majority |
| Output shape | Rich per-session object: `usdPerHour`, `velocityTrend`, `topContributor`, half-session pacing, etc. | Simpler: `durationHrs`, `totalUsd`, `totalTokens`, `usdHr`, `platform`, `platforms[]` |
| Consumers | `aggregateRows()` (the whole `analytics` object — sessions, platforms, insights, next-moves all derive from this), `app/live/page.js` (Personal Best/Peak Hour/Revenue Velocity baselines) | Only `StreamPlanner.js` internally (`bestWindows()`, `platformEfficiency()`, "This Week's Plan" table) |
| **This is a real conflict, not cosmetic:** | A tip sequence spanning two platforms within 4 hours produces **two sessions** under the canonical rule and **one session** under Stream Planner's rule — different session counts, different $/hr, different confidence numbers for the exact same underlying tips. |
| **Proposed canonical source** | `detectSessions()` — already the shared, documented ("never duplicate this grouping logic elsewhere") implementation used by both the main dashboard and Live Mode. |
| **Business-rule decision needed, not mine to make silently:** | Does Stream Planner's 4-hour/platform-agnostic rule reflect an intentional product decision (e.g., a creator who hops platforms mid-stream should count as one continuous session for scheduling purposes) or is it just independently invented? **Flagging as a real product question**, not resolving it here. |
| Migration risk | Moderate — Stream Planner's session counts/confidence levels will change numerically if migrated to the 3-hour/platform-boundary rule; needs a before/after comparison on real data before cutover. |

## 2. Platform efficiency ($/hr per platform)

| | `platforms`/`platformVelocity` (`aggregateRows()`) | `platformEfficiency()` |
|---|---|---|
| File | `lib/analytics.js` | `StreamPlanner.js` (82–107) |
| Inputs | `meaningfulSessions` (from `detectSessions()`) | Its own `groupIntoSessions()` output |
| Output | `usdPerHour`, `tokensPerHour`, `avgTipSize` per platform | `usdPerHr`, `tokensPerHr`, `avgTip`, **plus `bestUtcDay`/`bestUtcHour` per platform**, which the canonical version doesn't compute |
| Business-rule difference | Inherits session-rule #1's conflict — same tips can produce different per-platform totals depending on which session grouping is used | — |
| Proposed canonical source | `lib/analytics.js`'s `platforms` output, extended to also expose `bestUtcDay`/`bestUtcHour` per platform (Stream Planner's one genuinely useful addition) rather than Stream Planner maintaining its own copy |
| Consumers to migrate | `StreamPlanner.js`'s `bestWindows()` and the week-table renderer |
| Risk | Moderate — same numeric-change risk as #1, compounded by it |

## 3. Best-time / peak-hour — SIX confirmed independent implementations

| # | Implementation | File | Server/Client | Status |
|---|---|---|---|---|
| 1 | `get_user_insights` | Postgres RPC | Server | Canonical candidate — already plan-aware (PR #407), already the pattern to extend |
| 2 | `computeBestTimes()` | `lib/analytics.js` | Client | The one **already-correctly-shared** implementation (used by `aggregateRows()` and `app/live/page.js` identically) — closest client-side analog to canonical |
| 3 | `buildDailyBrief()`'s own hour-bucketing | `app/dashboard/page.js` (2697–2841) | Client | Duplicate — doesn't call `computeBestTimes()`; does its own per-platform-per-day bucketing from `analytics.platformBestTimes`, falling back to `analytics.bestHour` (i.e., #2) only when no platform/day-specific entry exists |
| 4 | `missedRevenueByPlatform`'s internal `platformBestTimes` bucketing | `lib/analytics.js` (1018–1032, inside `aggregateRows()`) | Client | Duplicate — a third independent hour-bucketing pass within the same file that also computes #2 |
| 5 | `predictRevenue()` | `lib/analytics.js` | Client | **Dead code — zero consumers found anywhere in the app**, confirmed by exhaustive grep this session |
| 6 | `generateLossAlerts()`'s `peak_missed` branch | `lib/analytics.js` | Client | Duplicate — its own best-hour-vs-current-hour comparison |
| 7 | `bestWindows()` | `StreamPlanner.js` (110+) | Client | Duplicate, and the richest of the client-side versions — full day×hour grid with confidence levels, whale-window flags, new-tipper rates. **None of this granularity exists in `get_user_insights` today.** |

**Business-rule note:** #2 (`computeBestTimes`) and #1 (`get_user_insights`) were not confirmed to use identical thresholds this session — both use a minimum-sample-size gate before trusting an hour bucket, but the exact numbers (`get_user_insights` requires ≥3 tips per hour bucket; `computeBestTimes`'s threshold was not re-verified this pass) need a direct comparison before either is declared authoritative over the other.

**Proposed canonical source:** `get_user_insights`, extended to return the full day×hour grid (matching `bestWindows()`'s granularity) rather than a single best-hour value — this is the single largest scope item in Phase 1, since #7 is currently the *most* capable implementation and also the one furthest from the server.

## 4. Monthly growth — THREE implementations, likely numerically consistent (lower risk than the above)

| | `aggregateRows()`'s `monthlyData`/`bestMonth` | `page.js`'s inline `_momThisRev`/`_momPrevRev` | `DashboardGrowthCharts.js`'s `monthlyUsdSeries()` |
|---|---|---|---|
| File | `lib/analytics.js` (~1080–1084) | `app/dashboard/page.js` (~3024–3035) | `app/dashboard/DashboardGrowthCharts.js` (73–86) |
| Grouping key | Calendar month (UTC) | Calendar month (UTC) | Calendar month (UTC) |
| Consumers | `monthly` tab | "Momentum indicator and KPI cards" per its own comment | The "Monthly Growth" panel inside `overview` |
| **Business-rule difference found** | None confirmed — all three appear to bucket by the same calendar-month key and sum `t.usd` the same way | — | — |
| **This is redundancy, not conflict** | Unlike sessions/best-time, no evidence these three would ever disagree — they're wastefully recomputed three times from raw `tips`, not divergently defined | — | — |
| Proposed canonical source | `aggregateRows()`'s `monthlyData`/`bestMonth` — already exists, already used by the `monthly` tab | — | — |
| Migration risk | **Low** — page.js's inline block and `DashboardGrowthCharts.js` can likely be repointed to read `analytics.monthlyData` directly with no numeric change, pending a direct verification pass |

## 5. Missed revenue / opportunity

Already covered in the prior monetization map — `get_user_insights`'s `missed_opportunity` (server, canonical candidate) vs. `missedRevenueByPlatform` (client) vs. `generateLossAlerts()`'s `peak_missed` branch (client). Not repeated in full detail here to avoid duplicating that document.

---
No code changed. Mapping only.
