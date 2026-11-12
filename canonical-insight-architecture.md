# Canonical Insight Architecture (design document, not implemented)

## Target shape

```
RAW TIPS / SESSIONS
        ↓
CANONICAL ANALYTICS ENGINE   (lib/analytics.js + lib/analytics/*, reused, not rewritten)
        ↓
SERVER-SIDE INSIGHT SERVICE  (new — runs the above server-side, per user, per request)
        ↓
PLAN-AWARE REDACTION          (one shared redaction step, not one-off per insight)
        ↓
FREE PREVIEW / PRO FULL INSIGHT
        ↓
UI
```

## Why this shape, given what was actually found

`lib/analytics.js` is confirmed pure JS with no browser-API dependencies (verified earlier
this session) — it can run in a Next.js API route unmodified. This is the entire reason
Option B was recommended over a SQL rewrite (Option A) or a full analytics-engine
replacement (Option C): the calculation logic mostly already exists and is mostly already
correct — the problem is *where* it runs and *whether the same instance runs everywhere*,
not that it needs to be reinvented.

## The twelve canonical insights, mapped to what exists today

| # | Insight | Canonical source today | Gap to close |
|---|---|---|---|
| 1 | Earnings | `aggregateRows()`'s `totalUSD`, session totals | None — already single-sourced |
| 2 | Monthly growth | `aggregateRows()`'s `monthlyData`/`bestMonth` | Two redundant client recomputes (`page.js` inline, `DashboardGrowthCharts.js`) need repointing — low risk, no rule conflict found |
| 3 | Sessions | `detectSessions()` | Stream Planner's `groupIntoSessions()` uses a different gap rule (4hr, no platform boundary) — **a real rule conflict**, needs a product decision before consolidation, not just a code change |
| 4 | Platform performance | `aggregateRows()`'s `platforms`/`platformVelocity` | Stream Planner's `platformEfficiency()` duplicates this and adds `bestUtcDay`/`bestUtcHour`, which the canonical version lacks — extend, don't discard that addition |
| 5 | Best earning windows | **No single canonical source today** — `get_user_insights` (single best hour), `computeBestTimes()` (client, shared correctly between dashboard/Live Mode), and Stream Planner's `bestWindows()` (full day×hour grid, richest but fully independent) are three different granularities of the same concept | This is the largest scope item — `get_user_insights` needs to grow to the day×hour grid granularity Stream Planner already computes, since that's the richest existing implementation, not the server one |
| 6 | Missed revenue | `get_user_insights`'s `missed_opportunity` (server, plan-aware already) | Two client duplicates (`missedRevenueByPlatform`, `generateLossAlerts`'s `peak_missed`) to retire once surfaces migrate |
| 7 | Fan intelligence | `identifyWhales()` | No duplicate found — single implementation, needs a server wrapper with plan-aware row-limiting, not a rewrite |
| 8 | Churn/re-engagement | `generateWhaleAlerts()`, `generateLossAlerts()`'s non-`peak_missed` branches | No duplicate found — needs the same server wrapper, plus the already-decided Free→Pro disposition change (aggregate-only Free preview) |
| 9 | Session opportunities | `getSessionBreakdown()` (`app/dashboard/page.js`, local function) | No server equivalent exists at all — genuinely new, not a migration |
| 10 | Platform opportunities | Partial — `aggregateRows()`'s comparison math + inline `page.js` Platforms-tab math | Needs consolidation into one comparison function, then a server wrapper |
| 11 | Timing opportunities | Same as #5 | Same gap |
| 12 | Recommendations | `generateNextMoves()` | No duplicate found — needs a server wrapper with the plan-aware slice (move #1 free, rest Pro) replacing the current CSS-blur gate |

## What is genuinely new vs. what is reuse-with-a-server-wrapper

**Reuse-with-a-server-wrapper (lower risk, majority of the work):** earnings, monthly
growth, sessions (pending the rule decision), platform performance, fan intelligence,
churn/re-engagement, recommendations. The calculation logic already exists in
`lib/analytics.js`; the work is invocation location + redaction, not new business logic.

**Genuinely new (higher risk, real design work):** the day×hour best-time grid at
`get_user_insights`-level granularity (currently only exists client-side in Stream Planner);
session-level opportunity generation (no server equivalent at all); a unified platform-
opportunity comparison function (currently split across two partial implementations).

## What must NOT happen

No new SQL reimplementation of anything `lib/analytics.js` already computes correctly. No
second server-side insight service competing with `get_user_insights` — it extends, it isn't
duplicated. No silent choice between the session-detection rule conflict — that's a documented
open decision (see `analytics-duplication-map.md`), not something resolved by whichever
implementation happens to get migrated first.

---
No code changed. Design document only.
