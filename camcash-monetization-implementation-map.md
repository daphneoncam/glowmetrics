# CamCash Monetization Redesign — Implementation Map (Phase 0, read-only)

No code changed. No PR created. This is the required Phase 0 deliverable per your spec —
inspection and mapping only. Everything here is either **VERIFIED** (confirmed this session
by direct code/data inspection) or carried forward from the three prior audit reports
delivered this session (architecture audit, monetization design input, conversion/checkout
audit), which this map treats as its evidentiary base rather than re-deriving.

**One correction to a stated premise, per your own Section 21 instruction to stop and explain
conflicts:** your brief states Stripe production is "already verified" and asks me not to
re-litigate it. My own conversion audit last turn found the opposite — no Stripe
dashboard/API access exists in this session (OAuth-gated), and production evidence (0 promo
redemptions, 2 of 3 "Pro" accounts with no Stripe customer ID, 0 checkout-completion events
ever) is more consistent with the paid path never having completed than with it working. I'm
carrying this forward as **UNKNOWN**, not re-auditing it at length, and flagging it only as a
required pre-Phase-6 verification step — a single manual test-mode checkout, not a
rediscovery project.

---

## 1. CURRENT ROUTE MAP

**Auth/account:** `/login`, `/forgot-password`, `/reset-password`. No dedicated `/signup`
route — signup is an inline form on `/` (landing), toggled via `isSignUp` state in
`LandingClient.js`.

**Core app:** `/` (landing, `app/page.js` SEO shell + `LandingClient`), `/onboarding`,
`/onboarding/chaturbate`, `/dashboard` (single route, tab-switched internally — see §3),
`/pricing`, `/live` (standalone Live Mode, same component as the dashboard's embedded tab),
`/live/demo`, `/demo`, `/landing/demo`.

**Content/SEO (unrelated to this redesign, listed for completeness):** ~55 `/blog/*` pages,
~11 `/guides/*` pages, `/tools/*`, `/shop/*`, `/affiliates`, `/contact`, `/privacy`, `/terms`.

**Admin/internal:** `/admin`, `/admin/login`, `/admin/preview`, `/preview-login`.

**Not yet existing (per your spec, would be new):** `/dashboard/opportunities` or equivalent
— confirmed absent from the route list above.

## 2. CURRENT DASHBOARD COMPONENT MAP

`app/dashboard/page.js` is a single ~7,000-line file rendering every tab via
`activeTab === "..."` conditionals — confirmed monolithic, matches your Section 13 concern
directly. Sub-components that already exist and are imported into it:
`Sidebar.js`, `DashboardPreview.js`, `OnboardingChecklist.js`, `CreatorReport.js`,
`StreamPlanner.js`, `MoneyMap.js`, `PrivateSessions.js`, `Settings.js`,
`AnalyticsCharts.js`, `DashboardGrowthCharts.js`. `LiveEnginePage` is `app/live/page.js`,
dynamically imported (`dynamic(() => import('../live/page'))`), shared between the dashboard's
"live" tab (`embedded` prop) and the standalone `/live` route — **one component, two mount
points, confirmed.**

**Current sidebar tabs** (`Sidebar.js` `NAV`, verified): `report` (Creator Report),
`overview` (Command Center — this is your target "Overview" redesign surface), `whales` (Top
Fans), `sessions` (Free Chat Sessions), `live` (Live Mode), `live-sessions`, `private`
(Private Sessions), `platforms`, `monthly`, `titles` (Room Titles), `calc` (Token Calc),
`analytics`, `planner` (Stream Planner), `moneymap` (Money Map), `data` (Edit Data), `upload`
(Import CSV), `help`, `settings`.

**Mapping your requested new IA onto this:** your spec's OVERVIEW → existing `overview` tab
(needs the redesign, not a new route). MONEY/Earnings → currently folded into `overview` and
`report`; MONEY/Opportunities → **does not exist**, would be new. AUDIENCE/Fans → existing
`whales` tab. PERFORMANCE/Platforms → existing `platforms` tab. PERFORMANCE/Sessions →
existing `sessions` tab (labeled "Free Chat Sessions" — note this label is platform-specific
terminology that may read oddly once the page covers all platforms; flagging as a copy
question, not deciding it). TOOLS/Daily Brief → currently a card *inside* `overview`, not its
own tab — your spec implies promoting it; TOOLS/Live Mode → existing `live` tab. TOOLS/Creator
Report → existing `report` tab. **Not mapped anywhere in your proposed IA:** `monthly`,
`titles`, `calc`, `live-sessions`, `private`, `data`, `upload`, `help` — eight existing tabs
with no stated home in the new structure. Per your Section 3 instruction ("do not remove a
route/functionality without mapping its current responsibilities first"), **this is an open
decision, not resolved here**: each needs an explicit "keep under X new section" or "keep in
a residual/settings area" call before navigation changes.

## 3. CURRENT ANALYTICS DEPENDENCY MAP

Fully built in the prior architecture audit — summarizing the load-bearing facts for this
redesign:

- `lib/analytics.js`'s `aggregateRows()` (imported as `runEngine`) is the legitimate
  client-side engine for whales, sessions, platform totals, next-moves, loss/whale alerts,
  best-times. **Confirmed pure JS** — no `window`/`document`/`localStorage` calls found in
  the functions read this session, consistent with safe server-side reuse, though not
  exhaustively verified line-by-line for every helper.
- `get_user_insights` (Postgres RPC) is the one genuinely server-side insight engine, now
  plan-aware (PR #407, delivered this session) for its own fields: `go_live_status`,
  `daily_plan`, `missed_opportunity`, `session_optimization`, `insights[]`, `summary`. Free
  callers get `has_data`, `go_live_status.status` only, and `momentum`.
- **Five independent implementations of peak-hour/missed-revenue logic** confirmed:
  `get_user_insights` (server), `buildDailyBrief()` (`page.js`, client), `missedRevenueByPlatform`
  (`lib/analytics.js`, client), `predictRevenue()` (`lib/analytics.js`, **dead code, zero
  consumers**), `generateLossAlerts()`'s `peak_missed` branch (`lib/analytics.js`, client).
  **This is the most important architectural fact for Phase 1** — your spec's "Biggest
  Opportunity" and "Today's Game Plan" components must not become a sixth.
- `computeBestTimes()` is the one example of correct sharing already in the codebase (used
  identically by `aggregateRows` and `app/live/page.js`) — the pattern to replicate, not
  reinvent.

## 4. CURRENT FREE/PRO GATING MAP

From the architecture audit, condensed: **only two mechanisms in the whole app are true
server-side gates** — the CSV/live platform-count limit (API 402 + DB trigger,
`enforce_free_tier_platform_limit`/`check_free_tier_platform_limit`) and, as of this session,
`get_user_insights`'s own fields. **Everything else is cosmetic** (computed client-side,
hidden by `isPro` JSX or, in CreatorReport's case, CSS `blur()` with real text still in the
DOM) **or, for Live Mode specifically, not gated at all** — `start_live_session` has no plan
check whatsoever; its own code comment says "every authenticated account can start it, no
flag, no allow-list." This is the single highest-severity fact for your Section 12
requirement ("a UI lock is not sufficient") — Live Mode isn't a UI-lock problem, it's a
missing-lock problem, a different bug class.

**Directly relevant to your new "Biggest Opportunity"/"Fan Intelligence" components:** the
Whale/CRM churn-risk alerts (`generateWhaleAlerts()`, `generateLossAlerts()`'s fan-churn
branch) are **currently completely free and ungated**, rendering in the "You're Losing Money"
card with real usernames and dollar values, no `isPro` check anywhere near that card. Your
spec's `FanSnapshotCard`/`OpportunitySummaryCard` designs assume this is Pro-gated
intelligence — **it currently is not**, and this needs a deliberate decision (already
flagged as the strongest available lever in the monetization design report) before Phase 2/3
can build against it correctly.

## 5. CURRENT UPGRADE-MODAL ARCHITECTURE

`openUpgradeModal(reason)` in `app/dashboard/page.js`, backed by a `UPGRADE_COPY` object
keyed by reason string (`multi_platform`, `platform_comparison`, `session_breakdown`,
`daily_forecast`, `whales_cutoff`, `creator_report`, `live_mode`, others) — confirmed real,
genuinely contextual (not a single generic modal), matches your Section 7 requirement's shape
already. `LockedInsightCard` is the reusable locked-state component, confirmed used across
Daily Brief, Session Breakdown, Platforms, Live Mode, StreamPlanner, MoneyMap. **This
infrastructure should be extended, not replaced** — consistent with your instruction not to
create duplicate components without searching first.

## 6. CURRENT PRICING ARCHITECTURE

`app/pricing/PricingClient.js`, confirmed $19.99/mo and $99/yr consistently (code lines
verified this session, matches the checkout route's `plan_type` keys exactly:
`standard_monthly`/`standard_annual`). FAQ section already lists Pro's intended feature set
(unlimited platforms, full tip history, CRM tools, cross-platform comparison, advanced Live
Mode coaching, churn/re-engagement insights, best-time analysis, Stream Planner, Money Map,
advanced reports) — **this copy already describes roughly your target Pro positioning**; the
gap is delivery/enforcement, not the pricing page's message.

## 7. CURRENT ONBOARDING/IMPORT FLOW

`app/onboarding/page.js`: platform selection → paste-lookup or CSV upload → import →
`onboarding_completed` event fires on first successful import. **Real, data-confirmed
problem:** `onboarding_paste_parse_failed` (56 events) exceeds successful CSV imports
(`csv_upload_success`, 22) — the paste-import path is the weaker of the two methods, by a
wide margin, in real usage. One un-updated copy instance ("Skip for now — continue with one
platform") still references the pre-PR-#404 1-platform limit.

## 8. CURRENT STRIPE/CHECKOUT FLOW

`/api/stripe/checkout` (creates/reuses Stripe customer via `profiles.stripe_customer_id`,
resolves price ID via a 3-deep env var fallback chain, validates `price_` prefix before use)
→ Stripe-hosted checkout → `success_url: /dashboard?success=true&plan=...` /
`cancel_url: /dashboard?canceled=true`. **No code found that consumes the `success=true`
query param** to show any confirmation state — flagged as UNKNOWN/likely-absent in the prior
audit, directly relevant to your Section 9 "Post-Purchase Experience" requirement, which
currently has no landing point to build on top of.

## 9. CURRENT WEBHOOK/POST-PAYMENT FLOW

`/api/stripe/webhook`: signature-verified, handles `checkout.session.completed`,
`customer.subscription.created/deleted/updated`, resolves user via
metadata → `stripe_customer_id` → email fallback, writes `profiles.plan` with checked
success/failure (500 on failure, so Stripe retries rather than silently succeeding).
**Deliberate `past_due` grace period** (kept Pro during Stripe's own retry window) — a real
design decision, not a bug. **Does not write to `analytics_events` on any branch** — the
single largest tracking gap for measuring your Section 10 funnel.

## 10. CURRENT CONVERSION/EVENT TRACKING

**Three parallel destinations confirmed:** `lib/tracking.js` (`track`/`trackOnce` →
`dataLayer`/`gtag`), `lib/track.js` (`track`, aliased `gtmTrack` in `page.js` → `dataLayer` +
`POST /api/track` → `analytics_events` table — the one queryable destination), and a bare
`require("@vercel/analytics").track` call directly in `page.js`. **A fourth interface found
this session, not previously catalogued:** `LandingClient.js` also calls a `TrackEvents.*`
API (`signupCtaClicked`, `signupCompleted`) distinct from the bare `track()` calls in the same
file — **whether `TrackEvents` reaches `analytics_events` or only GTM is UNKNOWN, not traced
to its import source this pass.** Your Section 10's instruction to "use the project's existing
analytics/event system" needs this resolved first, since there may be three or four systems
to choose from, not one.

**Real data (queried live, `analytics_events`, 983 rows total, 2026-06-23 to present):**
`signup_started` 130, `signup_success` 51, `onboarding_completed` 28,
`onboarding_paste_parse_failed` 56, `csv_upload_success` 22, `daily_forecast_locked_viewed` 4,
`session_breakdown_locked_viewed` 4, `paywall_hit` 2, `upgrade_clicked` 1,
`upgrade_checkout_started` 1, `upgrade_checkout_failed` 1, **zero** checkout-completion or
payment-success events of any kind. None of your Section 10's requested new event names
(`landing_view`, `aha_moment_reached`, `opportunity_preview_viewed`, `pro_activated`, etc.)
currently exist.

## 11. CURRENT CREATOR REPORT ARCHITECTURE

`CreatorReport.js`: receives `analytics`, `tips`, `isPro`, `engineInsights` as props. Reads
`analytics.nextMoves` directly, renders move #1 in full, moves 2+ under CSS `blur(3px)` —
**confirmed the weakest cosmetic gate in the whole app**, real text present in the DOM.
`analytics?.platforms` consumed here too — **whether this unconditionally surfaces a $/hr
figure to free users was flagged as unresolved in the prior audit and remains unresolved this
pass** (time did not permit a full line-by-line read of this file this session either).

## 12. CURRENT LIVE MODE ARCHITECTURE

`app/live/page.js` = `LiveEnginePage`, ~1750 lines. Real-time tip tracking via Supabase
Realtime subscription, session lifecycle via `/api/live/session/*` routes and
`useLiveSessionEngine()`, coaching prompts polled from `/api/live/coaching` (server-computed,
`lib/coaching/triggers.js` — the one genuinely correct server-side calculation in the app).
**Confirmed critical gap:** `start_live_session` (the RPC backing `/api/live/session/start`)
has no plan check — only a platform-count check via `check_free_tier_platform_limit`. The
dashboard-embedded tab correctly gates by not mounting the component for free users; the
standalone `/live` route mounts it unconditionally and only gates the "Start Streaming"
button — a free user calling the API directly bypasses this entirely. **This must be fixed
before any Live Mode monetization messaging is trustworthy**, independent of anything else in
this redesign.

## 13. FILES THAT MUST CHANGE (for the redesign as specified)

`app/dashboard/page.js` (Overview tab redesign, new component extraction — the largest,
highest-risk file to touch), `app/dashboard/Sidebar.js` (navigation restructure, contingent on
the 8-tabs-unmapped question in §2 being resolved first), a new server-side insight layer
(new API route(s)/RPC(s) — does not exist yet), `get_user_insights` (extend for the
Opportunity data model, or supersede with the new layer — decision needed), `lib/analytics.js`
(reused, not rewritten, per your Section 11 — but its functions need to be confirmed callable
server-side, §3 above), `app/api/live/session/start/route.js` or `start_live_session` (the
missing plan-check fix), `app/api/stripe/webhook/route.js` (add completion event tracking),
success-URL consumer in `app/dashboard/page.js` (new post-purchase moment), `PricingClient.js`
(outcome-driven copy, contingent on Pro's delivery actually matching by then).

## 14. FILES THAT SHOULD NOT CHANGE

Everything in `app/api/stripe/checkout` and `app/api/stripe/webhook`'s core logic (signature
verification, customer resolution, plan-write pattern) — sound, verified, no reason to touch
beyond the additive tracking-event write above. `lib/plan.js` (`isProPlan`) — single source of
truth, correct, no reason to change. The CSV/live platform-count trigger logic — real,
working gate, unrelated to this redesign. All ~55 blog/guide SEO pages, `/tools/*`, `/shop/*`
— out of scope, no stated reason to touch.

## 15. PROPOSED IMPLEMENTATION SEQUENCE

Matches your Section 19 phase structure — not resequencing it, just confirming it's sound
given what's now mapped: Phase 1 (analytics architecture) is correctly ordered first, since
Phases 2–5 all depend on knowing whether `lib/analytics.js` can run server-side unmodified
(§3's open question) and on the Whale/CRM free/Pro decision (§4) being made, not assumed.

## 16. RISKS

- **Navigation restructure risk:** 8 existing tabs have no home in your proposed IA (§2) —
  proceeding without resolving this risks silently orphaning functionality, which your own
  Section 3 explicitly warns against.
- **Duplication risk (repeated from the architecture audit, still live):** any new
  "Opportunity"/"Daily Game Plan" calculation must source from `get_user_insights` or the new
  Phase-1 layer, not reimplement peak-hour/missed-revenue math a sixth time.
- **`lib/analytics.js` server-reuse risk:** plausible but not exhaustively verified — every
  function should be checked for browser-API dependencies before Phase 1 assumes unmodified
  reuse.
- **Monolith-file risk:** `page.js` is ~7,000 lines; extracting components (§13) without
  regressions requires care, consistent with your Section 13's own caution.
- **Live Mode risk:** any Pro-value messaging built on Live Mode before the missing plan
  check is fixed would be marketing a feature that isn't actually gated.
- **Stripe verification risk:** carried forward from the top of this document — a real
  pre-Phase-6 check, not a rediscovery project, but not something to skip either.

## 17. UNKNOWNS

Whether `lib/analytics.js`'s functions are fully free of browser-only API dependencies.
Whether `CreatorReport.js` leaks a $/hr figure unconditionally. Whether `TrackEvents.*`
reaches `analytics_events` or a different/no destination. Whether the `success=true` query
param is consumed anywhere. Whether Stripe is registered/working in production at all
(flagged at the top). Where the 8 currently-unmapped sidebar tabs should live in the new IA.

## 18. PROPOSED ACCEPTANCE TESTS (mapped to your Section 20 criteria)

For each architecture item in your acceptance list: a direct SQL/RPC diff test (free-account
payload vs. Pro-account payload, same pattern already used to verify PR #407 live) proves "no
CSS-blurred secret Pro content" and "Pro receives full intended data." For Overview
density: a rendered-DOM check confirming every free-tier card in §16's density requirement
returns real content, not an empty/locked placeholder. For monetization: a click-through test
per upgrade surface confirming the correct `reason` reaches `openUpgradeModal` and the correct
checkout `plan_type` results. For conversion: confirm each new event name in §10 actually
inserts a row and is queryable, not just called.

## 19. WHAT I HAVE NOT YET DONE (explicitly, so nothing is assumed complete)

I have not read `CreatorReport.js`, `StreamPlanner.js`, or `MoneyMap.js` in full this session
— only their `isPro` gate points and prop signatures, confirmed via targeted greps across
three prior audits. I have not benchmarked `get_user_insights` or `aggregateRows()` latency
at scale. I have not confirmed Stripe production configuration. I have not designed the
Opportunity data model itself (that's Phase 2, not Phase 0). I have not written any component
code, migration, or PR.

---

Stopping here per your instruction. Waiting for review before Phase 1 begins.
