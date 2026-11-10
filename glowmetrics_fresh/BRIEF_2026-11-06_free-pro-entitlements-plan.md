# Brief — 2026-11-06 — Free vs Pro entitlements, pricing page, teasers (PLAN ONLY, rev. 2)

Read-only audit. No code, database, Stripe or Vercel changes were made.
Production checks were SELECT-only against Supabase project `hlsdlaibnayzbfflxclj`.

**Rev. 2 (same day):**
- Adds the owner's answers to D1–D7.
- Adds three required corrections: teaser metadata (C1), trial and billing fixes first (C2), timezone as a migration step (C3).
- Revises the implementation order.
- Adds a verified finding on paid subscribers and the conversion funnel (F13, F14).

---

## 0. Findings (data / billing integrity)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| F1 | **Critical** | **Stripe trial users get the Free plan during their trial.** The webhook sets `plan = status === 'active' ? 'pro' : 'free'`, so `trialing` gives `free`. Nothing in the UI reads a trial tier. The "7-day free trial" is still advertised. | `app/api/stripe/webhook/route.js:248,363`; hotfix `350b215` (Oct 18) |
| F2 | **Critical** | **The Free history window is browser-only.** RLS lets each user `SELECT` all of their own `tips`, `paid_sessions`, `live_tips` and `live_private_intervals`. The dashboard filters in JS. | `pg_policies`; `app/dashboard/page.js:1655,1671,2026,2081,2234` |
| F3 | High | **Four different definitions of "Pro":** `isProPlan` (expiry ignored), the dashboard inline check, `lib/stripe.js hasProAccess` (pro + active), and the DB rule `plan ≠ 'free' AND not expired`. | `lib/planLimits.js:18`, `app/dashboard/page.js:1647`, `lib/stripe.js:38`, migration 20261103 §2a |
| F4 | High | **2 profiles have `plan='pro'` with no Stripe subscription.** Their `subscriptions` rows say `active` with `plan_type standard_monthly`, but have no `stripe_subscription_id` and a period that ended 2026-10-09. Both were created 2026-09-09, which matches the September webhook-bug repair (`20260912_emergency_fix_emmyfox2_subscription_sync.sql`, goodwill grants). They are still treated as Pro everywhere. **Investigate before any change (D6).** | profiles + subscriptions queries |
| F5 | High | **The Nov 3 Live Mode migration IS applied in production**, although its header says otherwise. The repo also lacks `gate_live_mode_pro_only`, which exists only in production. | pg_proc / pg_trigger / cron.job |
| F6 | Medium | `check_free_tier_platform_limit` still enforces 3 platforms at Live start. It says **"Creator Pro ($19.99/mo)"**, which is wrong, and leaves out CamSoda. | production function body |
| F7 | Medium | Every checkout gets a 7-day trial unconditionally (re-trials are possible). Redirect URLs are built from the request `Origin` header. | `app/api/stripe/checkout/route.js:155,161` |
| F8 | Medium | The current Free window is anchored to each platform's newest tip, and the primary platform has unlimited history on Free. | `lib/analytics.js:2298-2360` |
| F9 | Medium | **248 of 281 profiles have no saved timezone.** Today's Live week falls back to the browser zone and then UTC, and the browser zone is client-supplied. | profiles query; `app/api/live/usage/route.js:20` |
| F10 | Medium | A Free stream that reaches its cap gets `ended_at` set to the moment it hit 35 active minutes, even if that moment is in the past. A Pro lapse mid-stream would end it retroactively. | migration 20261103 §2d |
| F11 | Low | The "Most Popular" badge on Pro is unsupported (see F13). | `app/pricing/PricingClient.js:415` |
| F12 | Low | `windowDays: 31` is hard-coded in 5 places. | see F2 lines |
| F13 | **High (business)** | **Verified: 0 paying Stripe subscribers.** The only 2 `active` subscription rows are the non-Stripe grants in F4. Admin stats count `subscriptions.status='active'`, so **admin dashboards may report 2 paying subscribers that do not exist.** | subscriptions query; `app/api/admin/stats/route.js:219`, `app/api/admin-stats/route.js:176` |
| F14 | High (business) | **Funnel, last 60 days** (`analytics_events`): `onboarding_import_completed` 17 → `onboarding_trial_screen_viewed` 11 → `onboarding_trial_skipped` 8 / `onboarding_trial_started` 1. `pricing_page_viewed` 3; `upgrade_click` 1. Since launch, `free_trial_events` has 5 rows in total. Very few users ever reach the pricing page or the upgrade click. | analytics_events query |
| F15 | Low | The pricing page promises **"30 days notice before material pricing or plan changes"**. The Terms promise 30 days' notice for pricing changes. This confirms D7 = 30 days. | `app/pricing/PricingClient.js:545`, `app/terms/page.js:68` |

---

## 1. Owner decisions (answered 2026-11-06)

| # | Decision |
|---|---|
| D1 | **The trial is full Pro for 7 days.** Fixing the trial entitlement comes first. |
| D2 | **Imports of secondary platforms are stored, with analysis restricted.** Nothing a user imports is discarded; it unlocks on subscription. |
| D3 | **No primary platform:** prompt the user to choose one, and show a temporary display default so no existing account opens to an empty dashboard. |
| D4 | **Failed payment (`past_due`):** temporary grace period that follows Stripe's configured retry schedule, with a **bounded end date** stored server-side. |
| D5 | **Pro expires while live:** the current stream finishes with no cap and no retroactive change to its totals. Free limits apply from the next session. |
| D6 | **The 2 grant accounts:** investigate first (origin, intent, owner confirmation), then decide. No change until then. |
| D7 | **Notice for existing Free users: 30 days**, matching the existing pricing page and Terms (F15). |

## 2. Required corrections

### C1 — Secure history restriction that keeps imports and teasers working
- Restricted rows **never leave the database** for a Free user: RLS returns only the primary platform's last 30 local days.
- Teasers instead use **one SECURITY DEFINER, caller-scoped RPC** (for example `get_locked_data_summary()`). It returns **aggregate metadata only**:
  - row counts and date span of restricted history, per platform;
  - the number of fans beyond the top 3;
  - whether more than 30 days of sessions exist.
- It returns no amounts, usernames or individual transactions, and is enforced with `auth.uid()`.
- It **replaces** the current client-side `summarizeWindowExclusion` signal; it is not a second engine. The rule "show a teaser only when real signal exists" stays.
- Imports are unaffected. Inserts go through the existing import RPCs and dedup, which are SECURITY DEFINER and read across all rows server-side. They are verified by tests for cross-window and cross-platform dedup.
- Unlocking: RLS reads the entitlement on every query, so a confirmed Pro or trial unlocks all preserved rows on the next load. No data moves.

### C2 — Trial entitlement and billing lifecycle before any pricing change
- One canonical DB function, `entitlement_tier(uid)`, generalized from the existing `is_live_mode_pro` (which stays as a wrapper; no competing check). It decides from:
  - `subscription_status` (active, trialing, past_due within grace, canceled, none);
  - `trial_ends_at` / `current_period_end` expiry;
  - explicit intentional grants, recorded as a dedicated grant reason with an expiry.
- **Not** simply `plan <> 'free'`.
- `lib/planLimits.js resolveEntitlement()` mirrors it for display only, with a JS/DB parity test.
- The webhook writes state; the tier is **derived**, never trusted from the browser.

### C3 — Timezone as a migration and onboarding requirement
- New creator-local limits (the 30-day window and the Live week) are **enabled per account only once a valid IANA zone is saved** (validated against `pg_timezone_names`).
- The browser zone is never used for enforcement.
- **Transition for the 248 accounts without a zone:**
  - prompt for the zone in the dashboard, Live and onboarding, pre-filled with the browser zone; the user confirms;
  - until they save one, the account keeps **today's behaviour** (current window rule; Live week as today) rather than being silently moved to UTC;
  - after the 30-day notice ends, show a blocking prompt before analytics or Live start, so the zone is saved before the new limits apply.
- Changing a saved zone is rate-limited (proposed: once per 7 days) so a week boundary cannot be gamed. Edits are logged.

## 3. Revised implementation order (small, separate PRs)

1. **Trial entitlement and central Pro access.** `entitlement_tier`, `resolveEntitlement`, parity tests, webhook trial → trial tier, migrating the `isProPlan` callers. Investigate F4 and correct the admin-stats count (F13).
2. **Checkout eligibility and subscription states.** Server-side trial eligibility (`GET /api/stripe/trial-eligibility`), no re-trials, `past_due` grace with an end date, redirect base from env, and the F6 copy.
3. **Secure Free data restrictions.** Plan-aware RLS, `free_window_start`, `get_locked_data_summary`, the timezone gate (C3). Staging first, then production with owner approval.
4. **Live Mode limits and existing-user transition.** 1-platform rule at Live start, the D5 rule (no cap on a stream that started under Pro), the 30-day notice (email + banner), the primary-platform prompt (D3).
5. **Site-wide Pro teasers** (extend `lib/proTeasers.js`, using C1 metadata).
6. **Polished pricing page release with verified claims.**
   - The **design** PR may be opened early as a draft.
   - Restrictive claims are published only after 3–4 are verified in production.
   - "Most Popular" is removed.

In parallel (analysis only, no code change without approval): a conversion review of the steps import → first insight → trial screen → upgrade click → checkout redirect → checkout complete (F14). Restricting Free alone may reduce engagement without increasing paid subscriptions.

## 4. Unchanged from rev. 1
- Policy table: Free = 1 platform, 30 local days, 2 Live starts per week × 35 active minutes, top 3 fans, locked previews. Pro and trial = everything.
- Pricing page structure and copy; "save 17%" is accurate ($99 vs $119.88 is 17.4%).
- Teaser placement map, and conflicting migrations (`20260910*`, `20261016`).
- Test matrix on the **Live Mode Testing** project only. It adds:
  - past_due within and after grace;
  - grant expiry;
  - no-timezone accounts;
  - a timezone change near a week boundary;
  - Pro lapsing mid-stream (D5).

---

## Tasks, most important first
### New / to do
1. (Critical) PR 1: trial = full Pro, plus the central entitlement rule (F1, F3). **Awaiting approval to start.**
2. (Critical) PR 3: server-side history restriction with the metadata RPC (F2, C1).
3. (High) Investigate the 2 grant accounts (F4/D6) and fix the admin-stats paid count (F13).
4. (High) PR 2: checkout eligibility, past_due grace, $19.99 copy (F6, F7).
5. (High) Timezone transition for 248 accounts (F9, C3).
6. (High) Conversion-funnel review (F14).
7. (Medium) Make the repo match production for 20261103 / gate_live_mode_pro_only (F5).
8. (Medium) PR 4 Live and transition, PR 5 teasers, PR 6 pricing release.
### In progress
- Plan rev. 2 awaiting owner approval.
### Completed
- Read-only audit (rev. 1); owner decisions D1–D7 recorded; paid-subscriber count and funnel verified (rev. 2).
