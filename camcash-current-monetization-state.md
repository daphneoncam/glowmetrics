# CamCash — Current Monetization State Report

Consolidated narrative of what's actually Free, actually Pro, and actually enforced —
synthesizing every audit performed this session. No code changed, no production modified.

## The core problem, stated plainly

CamCash's monetization strategy (raw data free, computed insight Pro) is sound in design.
Its execution has two distinct, different failure modes, and conflating them would lead to
the wrong fix:

1. **Cosmetic gating** — the server computes or the client independently computes the
   Pro-exclusive answer, and only rendering decides who sees it. Fixable by moving computation
   server-side with plan-aware redaction (Option B, already scoped).
2. **Missing gating** — Live Mode's `start_live_session` has no plan check at all, in either
   direction. Not a rendering problem — a fix requires adding a check that doesn't exist.

Both are real, both are mapped, neither has been fixed in this pass per your instruction.

## What's currently Free

Unlimited raw tip/session history, up to 2 platforms (pending the migration-sequencing note
below), real-time tip detection, top-3 fans, one Creator Report next-move, Daily Brief's
directional signal by *design* (though leaking elsewhere — see below), and — not by design,
simply because nothing gates it — the full "You're Losing Money" card (quantified missed
revenue, churn-risk fan alerts with names and dollar values), the Sticky Command Bar's exact
peak hour, and the Smart Insights card's exact hour/platform/$ average.

## What's currently Pro (by UI presentation)

The same computations, unblurred: exact peak hour/$ range, Session Breakdown causal analysis,
Platforms $/hr and comparison, fans beyond top 3, next-moves beyond #1, unlimited platforms,
Live Mode. **Whether Pro's technical delivery matches this presentation varies by category** —
see the entitlement map for the exact enforcement status of each.

## What was recently ungated (this session's own work)

`get_user_insights` (the server-side Daily Brief engine) is now plan-aware — PR #407,
delivered and verified live against real free/Pro accounts this session. This closed the
server-side half of the Daily Brief leak. It did **not** close three other surfaces
(Sticky Bar, Losing Money, Smart Insights) that read the client's own duplicate calculation
instead of the now-fixed server field — those three still leak, unchanged by PR #407.

## What is incorrectly exposed

In order of severity: (1) Live Mode — a free user calling the API directly gets the full
paid feature, zero resistance; (2) the Whale/CRM churn-risk alerts — specific fan usernames,
lifetime dollar values, and churn-risk levels, fully free, arguably the most sophisticated
CRM-caliber content in the app; (3) the missed-revenue $ figures and exact peak hour in the
Sticky Bar/Losing Money/Smart Insights surfaces; (4) CreatorReport's next-moves #2+, present
in the DOM under CSS blur — the weakest gate found, one inspector action from readable.

## What is incorrectly gated

Nothing found in this audit is *over*-restricted relative to the product's own stated
design — no case was found where Free is denied something the product intends it to have.
The asymmetry runs entirely one direction: things intended as Pro are under-enforced, not the
reverse.

## What Live Mode currently does

Real-time tip tracking (Supabase Realtime), AI coaching prompts (server-computed via
`lib/coaching/triggers.js` — the one genuinely correct server-side calculation in the app,
polled through `/api/live/coaching`), room-health/pace/momentum scoring, goal-pace
prediction, milestone tracking. Session lifecycle managed via `/api/live/session/*` routes
and `useLiveSessionEngine()`. **The dashboard-embedded tab gates correctly** (doesn't mount
the component for free users). **The standalone `/live` route and the underlying API do
not** — `start_live_session` checks only platform-count, never plan. Mapped in full in the
entitlement map; not fixed in this pass.

## Duplicate analytics implementations (peak-hour/missed-revenue concept specifically)

Five independent implementations confirmed: `get_user_insights` (server, SQL),
`buildDailyBrief()` (client, `page.js`), `missedRevenueByPlatform` (client,
`lib/analytics.js`), `predictRevenue()` (client, `lib/analytics.js`, **dead code — zero
consumers found anywhere in the app**), `generateLossAlerts()`'s `peak_missed` branch
(client, `lib/analytics.js`). `computeBestTimes()` is the one clean counterexample — shared
correctly between the dashboard and Live Mode, proof the codebase already knows how to avoid
this pattern when it wants to.

## PR #404 status

Not thrown away, not recommended to be. Its actual changes (contextual locked-card UI, the
`openUpgradeModal(reason)`/`UPGRADE_COPY` scaffolding, the 2-platform free-tier raise, funnel-
impression tracking for the three surfaces it touched) are sound and reusable. Its gap was
scope, not execution — it never touched Whale/CRM, Losing Money, or Live Mode's access
control, and none of the four surfaces it did gate were extended with server-side enforcement
beyond what this session's PR #407 separately added to one of them.

## Migration-sequencing note (carried from the original PR #404 review, still open)

The 2-platform free-tier raise ships as a migration in PR #404 that is explicitly **not**
applied to production per the PR's own body. If the code merges before the migration runs,
the app would tell free users they get 2 platforms while the DB trigger still enforces 1 — a
real, if narrow, correctness risk, unresolved as of this session.

---
No code changed. No production modified. Reporting only.
