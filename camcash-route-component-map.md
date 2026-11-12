# CamCash — Route / Component Dependency Map

Every sidebar item, dashboard tab, and top-level app route mapped to purpose, data source,
Free/Pro behavior, and a redundancy/disposition assessment. Confidence level noted per row —
several tabs were not deeply read this session and are marked accordingly rather than
described with false certainty.

## Dashboard tabs (single route `/dashboard`, internally tab-switched in `app/dashboard/page.js`)

| Tab (`id`) | Label | Route | Purpose | Data source | Free behavior | Pro behavior | Redundant? | Remain? | Move? | Merge? | New monetization surface? | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `report` | Creator Report | `/dashboard` (tab) | Summary rollup: headline numbers, best day/hour, top supporter, next-moves | `analytics`, `engineInsights`, `tips` via `CreatorReport.js` | Headline numbers + next-move #1 | Full next-moves list | No — distinct synthesis view | Yes | No | Candidate to absorb into new Overview's "Opportunities" surface per your spec, not a literal file merge | Already partly a monetization surface (next-moves gate) | High — read this session |
| `overview` | Command Center | `/dashboard` (tab) | Main dashboard — KPIs, Daily Brief, Losing Money, Smart Insights, platform/session summaries | `tips`, `analytics`, `engineInsights`, `dailyBrief` (client) | Real totals, directional signals (by design; several currently leak exact figures — see entitlement map) | Full figures | This is your spec's target "Overview" — not redundant, needs redesign not replacement | Yes | N/A (this is the anchor page) | N/A | Yes — this is where OpportunitySummaryCard/DailyGamePlanCard/FanSnapshotCard would live per your spec | High |
| `whales` | Top Fans | `/dashboard` (tab) | Ranked fan list by lifetime spend | `identifyWhales()` output (`lib/analytics.js`) | Top 3 | Full list | No | Yes | Maps to your spec's AUDIENCE/Fans | No | Yes — churn/CRM disposition decision (your item 3, resolved: move to Pro) applies here directly | High |
| `sessions` | Free Chat Sessions | `/dashboard` (tab) | Per-session timeline + breakdown | `detectSessions()`, `getSessionBreakdown()` (client, local to `page.js`) | Raw timeline/totals | Causal insights/recommendations | No | Yes | Maps to PERFORMANCE/Sessions | No | Already a monetization surface (locked card) | High |
| `live` | Live Mode | `/dashboard` (tab, embedded) | Real-time coaching | `useLiveSessionEngine`, `/api/live/coaching` | Locked card (mounting-level gate, correct) | Full engine | No | Yes | Maps to TOOLS/Live Mode | No | Already the intended flagship Pro surface — access gap unresolved (mapped, not fixed) | High |
| `live-sessions` | Live Mode Sessions | `/dashboard` (tab) | History of past live sessions | `live_sessions` table | **Not traced this session — UNKNOWN whether gated** | — | Possible overlap with `sessions` (both are "past session history," different source table) | **Needs your input** — real overlap risk with `sessions` tab | Candidate for TOOLS/Live Mode sub-area | Candidate merge target with `sessions`, not confirmed | Unclear — not traced | Low — not read this session |
| `private` | Private Sessions | `/dashboard` (tab) | BongaCams private/spy/group session tracking | `paid_sessions` table, `PrivateSessions.js` | **No `isPro` reference found anywhere in `PrivateSessions.js`** — appears fully free/ungated | Same as free | Platform-specific (BongaCams-only), narrower audience than most tabs | Depends on how much BongaCams usage exists — **UNKNOWN, no usage data available** | Could fold under PERFORMANCE/Sessions as a filter rather than a separate tab | Candidate merge target | Not currently one — could become a Pro CRM angle for high-value private-session fans, undecided | Medium — component read for gating, not for full feature scope |
| `platforms` | Platforms | `/dashboard` (tab) | Cross-platform comparison | `lib/analytics.js` `platforms`/`platformVelocity`, plus inline comparison math in `page.js` | Totals/hours per platform | $/hr, avg tip, comparison narrative | No | Yes | Maps to PERFORMANCE/Platforms | No | Already a monetization surface | High |
| `monthly` | Monthly | `/dashboard` (tab) | **Not traced this session — UNKNOWN exact content**, name implies month-over-month earnings view | Likely `analytics`/`tips`, unconfirmed | UNKNOWN | UNKNOWN | Possible overlap with the Overview's earnings-trend row your spec describes | **Needs investigation before a disposition call** | Possible candidate to fold into the new Overview's Earnings Trend row (7D/30D/90D/ALL) per your spec §4 Row 2 | Real merge candidate, unconfirmed | Not currently, plausible candidate | Low — not read |
| `titles` | Room Titles | `/dashboard` (tab) | Room-title generator tool | Standalone generator, unrelated to tip analytics | Free, per landing-page copy ("free to use without an account") | Same | No — distinct utility tool | Yes, but doesn't fit your MONEY/AUDIENCE/PERFORMANCE/TOOLS taxonomy cleanly | Could live under TOOLS alongside Daily Brief/Live Mode/Creator Report, or stay separate | No | Not a monetization surface today, not an obvious one to make into one (it's explicitly marketed as free) | Low — not read this session, inferred from label + landing copy |
| `calc` | Token Calc | `/dashboard` (tab) | Token↔dollar conversion calculator | Standalone utility | Free | Free | No | Yes | Could live under TOOLS | No | Not a monetization surface | Low — inferred, not read |
| `analytics` | Analytics | `/dashboard` (tab) | **Not traced this session — UNKNOWN exact content**, distinct from `AnalyticsCharts.js`'s consumer (need to confirm which tab renders that component) | Unconfirmed | UNKNOWN | UNKNOWN | **High overlap risk with `overview`/`platforms`/`monthly` given the generic name** | **Needs investigation before any disposition call — flagging as the single most ambiguous tab in the whole sidebar** | Unclear | Unclear | Unclear | Low — not read |
| `planner` | Stream Planner | `/dashboard` (tab) | Scheduling tool built around best-time data | `tips`, `windows`, `whales` props into `StreamPlanner.js` | `PlanTab` free; Whale Windows/Plan Progress tabs Pro-gated | Full access | Partial overlap with Daily Brief/Overview's timing intelligence — your spec's "Today's Game Plan" may functionally supersede part of this | Yes, but scope overlaps your new Overview design | Could become the "detail view" a Daily Game Plan CTA links to | Partial-merge candidate with the new Opportunities/Timing category | Already partly one | Medium — gate points confirmed, full UI not read |
| `moneymap` | Money Map | `/dashboard` (tab) | Session/Platform/Trends breakdown in a different visual format from `sessions`/`platforms` | `tips` prop into `MoneyMap.js` | `MoneyMapTab` (overview-style) free; Sessions/Platforms/Trends sub-tabs Pro-gated | Full access | **Significant overlap with `sessions` and `platforms` tabs** — three different tabs computing/showing session and platform breakdowns | **Needs your input** — this is the clearest duplicate-navigation-surface candidate in the sidebar | Strong merge candidate with `sessions`/`platforms` | Its Pro-gated sub-tabs are already a monetization surface, redundant with Session Breakdown/Platform comparison elsewhere | Medium — gate points confirmed, full UI not read |
| `data` | Edit Data | `/dashboard` (tab) | Manual tip data CRUD | `tips` table direct edit | Free (implied — data ownership isn't a Pro/Free axis) | Same | No | Yes | Could live under SETTINGS | No | Not a monetization surface, shouldn't become one (editing your own data isn't a premium feature) | Low — inferred, not read |
| `upload` | Import CSV | `/dashboard` (tab) | CSV/paste import | `/api/upload`, DB trigger | Up to 2 platforms | Unlimited | No | Yes | Stays wherever onboarding/data-entry lives | No | Already the platform-count monetization surface | High |
| `help` | CSV Help | `/dashboard` (tab) | Import documentation | Static content | Free | Free | No | Yes, but as content not a nav-level tab necessarily | Could live under SETTINGS or as a help link, not a primary nav item | No | Not a monetization surface | Low — inferred |
| `settings` | Account & Billing | `/dashboard` (tab) | Profile, subscription management | `Settings.js`, Stripe portal | Plan display, manage/cancel | Same, plus active-plan badge | No | Yes | Maps directly to your spec's SETTINGS | No | Natural home for the post-purchase confirmation moment (your spec §9) | High |

## Top-level app routes (outside the dashboard tab system)

| Route | Purpose | Notes |
|---|---|---|
| `/` | Landing + inline signup/login | Confirmed this session — demo panel, no dedicated `/signup` route |
| `/pricing` | Pricing page | Confirmed $19.99/mo, $99/yr, consistent with checkout |
| `/onboarding`, `/onboarding/chaturbate` | Post-signup import flow | Paste-import failure rate confirmed high (56 failures vs. 22 successful CSV imports) |
| `/live`, `/live/demo` | Standalone Live Mode + unauthenticated demo | Same component as the dashboard's embedded tab |
| `/demo`, `/landing/demo` | Marketing demo variants | Not traced this session |
| `/login`, `/forgot-password`, `/reset-password` | Auth | Not traced this session beyond confirming they exist |
| `/admin`, `/admin/login`, `/admin/preview`, `/preview-login` | Internal tooling | Out of scope for this redesign |
| ~55 `/blog/*`, ~11 `/guides/*`, `/tools/*`, `/shop/*`, `/affiliates`, `/contact`, `/privacy`, `/terms` | SEO/content/unrelated | Out of scope |

## Highest-ambiguity items, flagged explicitly rather than guessed at

**`analytics` tab** — the single most ambiguous item in the entire sidebar. Generic name,
not traced this session, real risk of overlapping with `overview`/`platforms`/`monthly`.
**`monthly` tab** — likely overlaps your spec's new Earnings Trend row. **`moneymap` tab** —
the clearest three-way duplication candidate (`sessions`/`platforms`/`moneymap` all show
session- and platform-level breakdowns in different UI shapes). **`live-sessions` vs.
`sessions`** — both are "past session history," different source tables, overlap
unconfirmed. These four are flagged as needing your decision or a follow-up investigation
pass before Phase 3 navigation work, not resolved here.

---
No code changed. No navigation modified. Mapping only.
