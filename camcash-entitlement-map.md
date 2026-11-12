# CamCash — Entitlement Map

Every place plan status is checked (or should be but isn't), across the codebase and
database, as of this session's live audits. No code changed to produce this document.

## Client-side `isPro` check sites (8 files, confirmed by grep — no others found)

| File | What it gates | How |
|---|---|---|
| `app/dashboard/page.js` | Daily Brief exact hour/$, Session Breakdown insights, Platforms $/hr, Top Fans beyond 3, Live Mode dashboard tab, import copy, checklist "add 2nd platform" step, sidebar prop pass-through | `isPro` boolean prop from `isProPlan(profile)`, branched JSX throughout |
| `app/dashboard/DashboardPreview.js` | Free-plan platform-count messaging | `isPro`/`platformCount` conditional copy |
| `app/dashboard/OnboardingChecklist.js` | "Add a 2nd platform" step routing (`upgrade: false` — not actually a paywall) | `isPro` prop, mostly cosmetic here |
| `app/dashboard/Sidebar.js` | Live Mode 🔒 icon; Pro-plan badge vs. "Upgrade to Pro" button | `isPro` prop |
| `app/dashboard/CreatorReport.js` | Next-moves #2+ (CSS `blur()`, real text in DOM); "Creator Pro compares all your platforms" copy | `isPro` prop |
| `app/dashboard/StreamPlanner.js` | Whale Windows tab, Plan Progress tab | `isPro` prop, default `true` on internal sub-components (`isPro=true` default — only overridden by the real value passed from the top-level export, confirmed not a live bug but worth noting as a slightly fragile default) |
| `app/dashboard/MoneyMap.js` | Sessions/Platforms/Trends tabs | `isPro` prop, same default-`true`-internally pattern as StreamPlanner |
| `app/dashboard/Settings.js` | Plan badge display, cancel/manage-subscription UI | `isPro` prop |

## Files with NO `isPro` reference at all (confirmed by grep — worth naming explicitly)

`app/dashboard/PrivateSessions.js`, `app/dashboard/AnalyticsCharts.js`,
`app/dashboard/DashboardGrowthCharts.js` — none of these files check plan at all. **This
doesn't necessarily mean anything is wrong** — it may simply mean nothing in them is intended
to be Pro-gated. Flagging as a fact to verify against intent, not as a confirmed problem: has
not been checked whether these three render anything that *should* be plan-aware and isn't.

## Server-side plan checks (the only real enforcement in the app)

| Location | Checks | Enforces |
|---|---|---|
| `enforce_free_tier_platform_limit()` (Postgres trigger fn) | `profiles.plan` | CSV/historical tip platform-count cap (2, pending migration sequencing) |
| `check_free_tier_platform_limit()` (Postgres fn, called by `start_live_session`) | `profiles.plan`, `profiles.plan_expires_at` | Live-session platform-count cap (1) — **not the same thing as gating Live Mode access itself** |
| `app/api/upload/route.js` | Server-side re-check before insert (402 response) | Same platform-count cap, redundant-but-correct defense in depth with the DB trigger |
| `get_user_insights` (Postgres fn) | `profiles.plan`, `profiles.plan_expires_at` (added this session, PR #407) | Daily Brief's exact-hour/$/insights fields |
| `lib/plan.js`'s `isProPlan()` | `profile.plan`, `profile.plan_expires_at` | The single client-side source of truth every `isPro` prop above derives from — correctly centralized, the one part of the client-side gating story that's architecturally sound even though what it gates often isn't enforced server-side |

## Confirmed absence of a plan check (the Live Mode gap — mapped, not fixed, per your instruction)

`start_live_session` (Postgres fn, backing `POST /api/live/session/start`) calls
**only** `check_free_tier_platform_limit()` — a platform-*count* check, not a plan-*tier*
check. Its own code comment states: *"There is exactly one Live Engine; every authenticated
account can start it, no flag, no allow-list."* No call to `isProPlan`-equivalent logic
exists anywhere in this function or the route wrapping it (`app/api/live/session/start/route.js`,
re-read this session, confirmed unchanged from the earlier trace). The dashboard-embedded Live
Mode tab (`app/dashboard/page.js`) is gated correctly at the *mounting* level (`isPro ?
<LiveEnginePage embedded /> : <LockedInsightCard/>`) — but the standalone `/live` route
mounts `LiveEnginePage` unconditionally for any authenticated user and only gates the
"Start Streaming" button client-side, which the API route itself doesn't require. **This is
the only place in the entire audited surface where a Pro-gated feature has zero server
enforcement of the plan dimension specifically** — every other cosmetic gate at least computes
the right *answer* server-side somewhere (even if it also leaks it); this one never checks at
all. Not fixed in this pass, per your explicit instruction.

## Every current Pro-only insight — gated server-side, or merely hidden in the UI?

| Insight | Server-side gated? | Evidence |
|---|---|---|
| Daily Brief exact hour/$ (`get_user_insights`) | **Yes**, as of PR #407 | Verified live against real free/Pro accounts this session |
| Daily Brief exact hour/$ (`buildDailyBrief()`, client) | **No** | Computed unconditionally in `page.js`; feeds the Sticky Command Bar and Smart Insights card, both of which render it with **no `isPro` check at all** |
| "You're Losing Money" — missed revenue $ (`missedRevenueByPlatform`) | **No** | Computed in `lib/analytics.js`, rendered with no `isPro` check anywhere near the card |
| "You're Losing Money" — loss/churn alerts (`generateLossAlerts`, `generateWhaleAlerts`) | **No** | Same card, same absence of a gate — includes named fans and $ lifetime values |
| Session Breakdown insights (`getSessionBreakdown()`) | **No** (cosmetic — JSX-gated correctly, but computed client-side regardless of plan) | Confirmed in PR #404 diff review |
| Platforms comparison ($/hr, avg tip) | **No** (cosmetic) | `platforms`/`platformVelocity` computed in `lib/analytics.js` unconditionally; only rendering branches |
| Top Fans beyond 3 | **No** (cosmetic) | Full `filteredWhales` array in memory; `.slice(0,3)` at render only |
| CreatorReport next-moves #2+ | **No**, weakest form found | CSS `blur()`, real text in DOM |
| Live Mode | **No**, not even cosmetically — see above | Zero plan check in the call chain |

---
No code changed. No production modified. Mapping only.
