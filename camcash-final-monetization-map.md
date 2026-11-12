# CamCash — Final Monetization Map

Every current monetization surface, mapped. No entitlement logic modified.

| Surface | Free feature | Pro feature | Current UI gate | Current server gate | Current data exposure | Upgrade trigger | Upgrade destination | Conversion event | Recommended new behavior |
|---|---|---|---|---|---|---|---|---|---|
| **Daily Brief (card)** | Pattern-exists signal, real-time "you're in it now" nudge | Exact hour, $ range | `isPro`-branched JSX, correct | **Yes**, as of PR #407 (`get_user_insights`) | None — the one surface where UI gate and server gate agree | `openUpgradeModal('daily_forecast')` | Pricing/checkout | `daily_forecast_locked_viewed` (4 real events) | Keep as the model for every other surface below |
| **Sticky Command Bar** | N/A — not designed as a gate | Exact hour, best platform, shown to everyone today | **None found** | None | **Full exposure to all users, unconditional** | N/A — no trigger exists here | N/A | None | Should read from the server layer's redacted field, matching the Daily Brief card, not the client's independent calc |
| **"You're Losing Money" card** | N/A — currently fully free | Quantified missed revenue $, churn/loss alerts | **None found anywhere near this card** | None | **Full exposure — the single most valuable ungated content in the app** (specific $ figures, named at-risk fans, lifetime values) | N/A | N/A | None | Rebuild as the core of MONEY/Opportunities' Missed Revenue category — Free gets "you have off-peak sessions," Pro gets the $ figure |
| **Smart Insights card** | N/A — currently fully free | Exact hour, platform, $ average, "Nx your rate" | **None found** | None | Full exposure | N/A | N/A | None | Same fix as Sticky Bar — source from the redacted server field |
| **Whale/CRM churn alerts** | N/A — currently fully free | Named fans, $ lifetime value, churn-risk level, suggested action | **None found** | None | **Full exposure** — the second-most valuable ungated content found | N/A | N/A | None | Move to Pro per the decision already made: Free gets an aggregate count ("2 fans at risk"), Pro gets full detail |
| **Session Breakdown** | Raw timeline/totals | Causal insights, recommendations | `isPro`-branched JSX, correct | No — cosmetic, computed client-side regardless of plan | Computed in full for everyone, only rendering differs | `openUpgradeModal('session_breakdown')` | Pricing/checkout | `session_breakdown_locked_viewed` (4 real events) | Needs a new server RPC/endpoint — none exists yet for per-session granularity |
| **Platforms comparison** | Totals/hours | $/hr, avg tip size, comparison narrative | `isPro`-branched JSX, correct | No — cosmetic | Computed in full for everyone | `openUpgradeModal('platform_comparison')` | Pricing/checkout | `platform_limit_preview_shown` (5 real events, though this specifically tracks the *import*-limit preview, not the comparison-card view — worth not conflating the two in future analysis) | Needs a new server RPC — `get_user_insights` has a partial start (`v_best_platform`/`v_worst_platform`) but not the full breakdown |
| **Top Fans beyond 3** | Top 3 fans | Full ranked list | `.slice()` at render | No — cosmetic | Full list computed and held in client memory | `openUpgradeModal('whales_cutoff')` (name confirmed in `UPGRADE_COPY`) | Pricing/checkout | None confirmed specific to this surface | Needs a server-side ranked-fan query limited by plan at the query layer, not the render layer |
| **CreatorReport next-moves** | Move #1 | Full list | CSS `blur(3px)` | No — the weakest gate found, real text in DOM | Full text present in DOM, one devtools action from readable | `openUpgradeModal('creator_report')` | Pricing/checkout | `creator_report_viewed` (20 real events — but this tracks the *page view*, not specifically the locked-content interaction) | Fix the gate mechanism itself (stop rendering the text at all, not just visually) as part of any touch to this component |
| **Live Mode** | Locked entry screen (dashboard tab only) | Full engine | Correct at the dashboard-tab mounting level; **absent** on the standalone route and the underlying API | **No — confirmed zero plan check in `start_live_session`** | A free user calling the API directly gets full functionality | `openUpgradeModal('live_mode')` | Pricing/checkout | None found specific to Live Mode impressions | **Highest-priority fix in the whole map** — not implemented this pass per instruction, but this is a different bug class (missing, not cosmetic) from everything else on this list |
| **Platform-count limit (CSV import)** | Up to 2 platforms | Unlimited | 402 response + soft-paywall preview UI | **Yes — DB trigger `enforce_free_tier_platform_limit`, real** | None — correctly enforced | `openUpgradeModal('multi_platform')` | Pricing/checkout | `platform_limit_preview_shown` (5 real events) | Keep as-is; this is the one fully-correct mechanism in the whole app, alongside Daily Brief post-PR#407 |
| **Pricing page** | N/A | N/A | N/A | N/A | N/A | Direct nav link + every `openUpgradeModal` CTA | Stripe checkout | **No page-view event exists** | Add view tracking |
| **Checkout** | N/A | N/A | N/A | N/A | N/A | Pricing page CTAs | Stripe-hosted checkout | `upgrade_checkout_started`/`upgrade_checkout_failed` (1 each, ever) | Add completion-event tracking to the webhook handler |
| **Post-purchase activation** | N/A | Should show a confirmation + first Pro insight per the approved architecture | **No code found consuming `?success=true`** | N/A | N/A | N/A | Redirect to `/dashboard?success=true` | None | Build the confirmation moment — currently the redirect lands with no visible acknowledgment found |

## Specifically-requested audits, consolidated

**Peak-hour intelligence / missed revenue:** five independent implementations, one canonical
(`get_user_insights`), four duplicates (three client — `buildDailyBrief`,
`missedRevenueByPlatform`, `generateLossAlerts`'s `peak_missed` branch — plus one dead-code
client implementation, `predictRevenue`). Full detail in the component map above.

**Whale/fan intelligence + churn risk:** currently 100% free, ungated, real names and dollar
values exposed — the single largest Free→Pro content shift in this whole mapping exercise,
already decided (move to Pro).

**Creator Report:** weakest gate in the app (CSS blur), plus one unresolved question
(possible `platforms` $/hr leak) carried across two audit passes without resolution.

**Live Mode:** mapped exhaustively in the component and route maps; not fixed per instruction.

**Pricing/checkout/subscription state/webhook/Pro activation/cancellation:** core logic
verified sound (signature checks, checked writes, deliberate `past_due` grace period).
Production Stripe functioning accepted per your correction — not reopened. Two real gaps
found and *not* about whether Stripe works: no checkout-completion tracking event, and no
confirmed post-purchase confirmation UI.

---
No code changed. No entitlement logic modified. Mapping only.
