# CamCash — Final Feature Disposition

Every feature, explicit disposition with destination and reason. Mapping only, nothing
implemented.

| Feature | Disposition | Where it goes / why |
|---|---|---|
| Command Center (`overview`) | **REBUILD** | Becomes OVERVIEW proper — needs Opportunity/Fan-Snapshot/Platform-Snapshot rows added; the 3 currently-ungated leak surfaces within it (Sticky Bar, Losing Money, Smart Insights) must close as part of this rebuild, not survive into the new version unchanged |
| Monthly earnings view | **MOVE** → MONEY/Earnings | Clean conceptual fit, self-contained block, low risk |
| Analytics charts (`AnalyticsCharts.js`) | **MERGE** → MONEY/Earnings or OVERVIEW | Pure render layer over the same `analytics` object `monthly`/`overview` use — no unique data, redundant as a standalone nav item. **DUPLICATE** (of presentation, not calculation) |
| Opportunities page | **REBUILD (new)** → MONEY/Opportunities | Does not exist today; the core new monetization surface, must be built on the server-side insight layer, not a sixth independent calculation |
| Top Fans / whales | **MOVE** → AUDIENCE/Fans | Direct fit; Free/Pro split inside it changes substantially per the churn-risk decision already made |
| Whale/CRM churn alerts (`generateWhaleAlerts`) | **REBUILD** → AUDIENCE/Fans, Pro | Currently 100% free and ungated — **the single largest disposition change in this entire document**. Target: Free gets an aggregate count, Pro gets names/$/suggested action |
| Platforms comparison | **MOVE** → PERFORMANCE/Platforms | Direct fit, gating mechanism (cosmetic today) needs the server-layer fix, not a relocation |
| Sessions / Session Breakdown | **MOVE** → PERFORMANCE/Sessions | Direct fit |
| Money Map | **RETIRE** (as a standalone tab) | **DUPLICATE** — its three sub-tabs (Sessions/Platforms/Trends) are confirmed one-to-one redundant with PERFORMANCE/Sessions, PERFORMANCE/Platforms, and MONEY/Earnings. Keeping it as a fourth tab recreates the exact problem already flagged |
| Live Mode | **MOVE** → TOOLS/Live Mode | Direct fit for the move; the missing server-side plan check is **UNFINISHED** and tracked separately, not resolved by relocating the tab |
| Live Mode Sessions (`live-sessions`) | **MERGE** → TOOLS/Live Mode (history sub-view) | Distinct from CSV-derived `sessions`; belongs with Live Mode's own lifecycle data. **REASSESS** its entitlement status — not confirmed gated either way this session |
| Creator Report | **MOVE** → TOOLS/Creator Report | Direct fit; its CSS-blur gate is the weakest found in the app and should be fixed as part of any touch to this component, not left as-is |
| Creator Report's `platforms` consumption | **REASSESS** | Whether it unconditionally surfaces a $/hr figure to free users remains unconfirmed after two audit passes — needs a dedicated read before the server-layer redesign locks in its contract |
| Stream Planner | **MOVE** → TOOLS/Stream Planner | Direct fit; real conceptual overlap with the new Daily Game Plan/Opportunities timing category is a **REASSESS** item for later, not a blocker now |
| Room Titles | **MOVE** → TOOLS/Room Titles | Direct fit, no gating concerns, explicitly marketed as free |
| Token Calculator | **MOVE** → TOOLS/Token Calculator | Direct fit, no gating concerns |
| Edit Data | **MERGE** → UTILITY/Data & Import | Paired with Import CSV per the approved IA |
| Import CSV | **MERGE** → UTILITY/Data & Import | Paired with Edit Data; carries the pre-existing, unrelated migration-sequencing note (2-platform cap migration not yet applied to prod) — **UNFINISHED**, independent of this redesign |
| CSV Help | **MOVE** → UTILITY/Help | Direct fit |
| Account & Billing | **MOVE** → UTILITY/Settings | Direct fit; natural home for the post-purchase confirmation moment, which is currently **UNFINISHED** (no code found consuming the checkout `success=true` redirect) |
| Private Sessions | **MERGE** → PERFORMANCE/Sessions | No standalone slot in the approved IA; **confirmed fully free/ungated today**, narrower audience (BongaCams-specific) |
| `buildDailyBrief()` (client peak-hour calc) | **REBUILD** | **DUPLICATE** of `get_user_insights` — must be narrowed to its free-safe outputs only, with Pro fields sourced from the server layer |
| `missedRevenueByPlatform` | **RETIRE** | **DUPLICATE** of `get_user_insights`'s `missed_opportunity` — needs a replacement source in the "Losing Money"/Opportunities surface before removal |
| `predictRevenue()` | **RETIRE** | **DUPLICATE** concept, and **UNFINISHED/dead** — confirmed zero consumers anywhere in the app; safe to delete or revive deliberately, not left as-is |
| `generateLossAlerts()`'s `peak_missed` branch | **RETIRE** | **DUPLICATE** of the above; the function's other three alert types (`tip_drop`, `fan_churn`, `streak_broken`) are not duplicates and should be kept, just relocated |
| `get_user_insights` (server RPC) | **REBUILD (extend)** | The canonical implementation everything else duplicates — target for extension (per-session, per-platform granularity), not replacement |
| Upgrade modal / `LockedInsightCard` infrastructure | **KEEP + EXTEND** | Proven, contextual, reusable — needs new `reason` keys for Opportunities and Fan Intelligence, not a rebuild |
| `DashboardGrowthCharts.js` | **REASSESS** | Not read this session — content, data source, and gating status all unconfirmed; flagged rather than guessed at |
| Onboarding checklist | **KEEP** | No changes needed |
| Stripe checkout/webhook core logic | **KEEP** | Verified sound; only additive change scoped (checkout-completion event tracking), no structural change |
| `lib/plan.js` (`isProPlan`) | **KEEP** | Single correct source of truth, no reason to touch |

---
No code changed. Mapping only.
