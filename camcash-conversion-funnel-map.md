# CamCash — Conversion Funnel Map

Standalone reference document, consolidating the full conversion audit delivered this session.
No new investigation in this file beyond what was already verified; repackaged into its own
document per your request.

## The funnel, stage by stage, with verification status

Visitor → Landing (`/`, `LandingClient.js` — demo panel, inline signup form, VERIFIED) →
Signup (email+password, captcha, Supabase `auth.signUp`, no dedicated route, VERIFIED) →
Account creation (`profiles.plan` defaults `'free'` at the DB column-default level, VERIFIED)
→ Onboarding (`/onboarding`, platform → paste/CSV → import, VERIFIED) → First analytics
result (dashboard `loadData()`, direct client Supabase query + `get_user_insights`,
VERIFIED) → Free dashboard (VERIFIED) → Pro discovery (`openUpgradeModal(reason)`
surfaces, VERIFIED, real but nearly unmeasured — 1 `upgrade_clicked` event ever) → Pricing
(`/pricing`, VERIFIED, no view-tracking event exists) → Checkout (`/api/stripe/checkout`,
CODE-VERIFIED, price-ID resolution UNKNOWN in production) → Payment (Stripe-hosted, outside
app code, UNKNOWN by definition) → Webhook (`/api/stripe/webhook`, CODE-VERIFIED, no
completion event written to `analytics_events`) → Database subscription state
(`profiles.plan`/`plan_expires_at`, CODE-VERIFIED) → Pro activation (redirect to
`success_url`, no confirmed confirmation-state consumer found, UNKNOWN) → Repeat usage
(no retention-specific instrumentation exists, UNKNOWN by construction).

## Real, queried conversion numbers (not estimated)

From live `analytics_events` (983 rows, 2026-06-23 to present): `signup_started` 130 →
`signup_success` 51 (**39%** form-completion rate) → `onboarding_completed` 28 (**55%** of
successful signups) → `csv_upload_success` 22. `onboarding_paste_parse_failed`: **56** — the
single largest onboarding-related event in the whole table, exceeding both successful CSV
imports and `onboarding_completed` itself. Locked-card impressions: `daily_forecast_locked_
viewed` 4, `session_breakdown_locked_viewed` 4, `paywall_hit` 2. `upgrade_clicked`: 1, ever.
`upgrade_checkout_started`/`upgrade_checkout_failed`: 1 each, ever. No checkout-completion or
payment-success event exists in the schema at all.

**Ground truth from `profiles` directly:** 128 total accounts, 125 `plan='free'`, 3
`plan='pro'`. Per your correction, at least one of these three is a confirmed real paying
subscriber — noted and accepted; this document no longer treats Stripe's production
functioning as an open question. (The instrumentation gap — no event fires on checkout
completion — is a separate, still-real fact: it means future conversions past this one won't
be visible in `analytics_events` without adding that write to the webhook handler.)

## Tracking systems, disambiguated (resolved this session)

Two genuinely separate systems exist: `lib/track.js`'s `track()` → `POST /api/track` →
`analytics_events` (the only queryable destination, source of every number above), and
`lib/tracking.js`'s `T`/`TrackEvents` object → GTM `dataLayer`/`gtag` only, **never** reaching
`analytics_events`, confirmed by reading its definition this session. These use different
literal event names for overlapping moments (`'signup_started'`/`'signup_success'` via the
first system vs. `'signup_cta_clicked'`/`'signup_completed'` via the second) — genuinely
unreconciled, not a naming variant of the same pipe.

## Funnel leaks, carried from the full conversion audit (ranked, unchanged by this session's
new work)

1. No instrumentation on checkout completion (blocks measuring everything past checkout-start).
2. Onboarding's paste-import path fails more than it succeeds (56 vs. 22).
3. Signup-form completion is 39% — largest quantified absolute drop in the funnel.
4. No pricing-page view tracking exists.
5. No post-payment confirmation UI found.
6. Pro's marketing claim (pricing FAQ) currently outruns its technical enforcement in several
   categories (see the entitlement map).
7–10: see the full conversion/checkout audit delivered earlier this session for the complete
ranked list with severity/confidence/category breakdowns — not re-derived here to avoid
duplicating that report's content verbatim.

---
No code changed. No production modified. Reporting only.
