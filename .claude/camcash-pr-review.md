# CamCash PR Review — Reviewer Instructions

These are the standing instructions for the automated CamCash pull-request
reviewer (`.github/workflows/camcash-pr-review.yml`). The reviewer **reports
only**. It never edits files, fixes issues, commits, pushes, merges, approves,
or requests changes through the GitHub review API.

The application lives in `glowmetrics_fresh/` (Next.js 14 App Router,
Supabase, Stripe, Vercel). The Chrome extension lives in `chrome-extension/`.

---

## 0. Sources of truth — read these, do not duplicate them

| Topic | Source |
|---|---|
| Project rules, formulas, security rules, brand palette, card/button styles, UI rules | `CLAUDE.md/project-and-code-requirements` (note: `CLAUDE.md` is a **directory** in this repo) |
| Token rates | `glowmetrics_fresh/lib/constants.js` (`PLATFORM_TOKEN_RATES`, `tokenRate()`) |
| Free/Pro constants | `glowmetrics_fresh/lib/planLimits.js` (`FREE_PLATFORM_LIMIT`, `FREE_ANALYSIS_WINDOW_DAYS`, `isProPlan`, `MODULE_DATA_THRESHOLDS`) |
| Server-side Pro check | `glowmetrics_fresh/lib/stripe.js` |
| Stripe plan state | `glowmetrics_fresh/app/api/stripe/webhook/route.js`, `app/api/stripe/checkout/route.js` |
| Analytics engine / parsing | `glowmetrics_fresh/lib/analytics.js`, `lib/analytics/*` |
| Session grouping | `glowmetrics_fresh/lib/analytics/sessions.js` (`detectSessions`) |
| Event tracking helpers | `glowmetrics_fresh/lib/track.js`, `lib/tracking.js`, `lib/analytics-client.js`, `app/api/track/route.js` |
| Database / RLS | `supabase/migrations/`, `glowmetrics_fresh/supabase/`, `glowmetrics_fresh/migrations/` |

Use the existing application as the design source of truth. Do not invent a
new design system and do not recommend one.

**Never recommend editing `glowmetrics_fresh/app/onboarding/page.js` through the
GitHub web editor** (300KB+, truncation risk). If a PR edits that file, check
the diff for signs of truncation (file ending mid-statement, large unexplained
deletions) and report it as BLOCKING if found.

---

## 1. Severity labels

Use only these labels. Never assign numeric scores and never rank the PR.

- **BLOCKING** — must be fixed before merge: security/data exposure, entitlement
  bypass, wrong money/analytics math, broken build/tests, data loss, truncation.
- **IMPORTANT** — should be fixed: probable bugs, regressions, missing server-side
  enforcement, inaccurate user-facing claims, accessibility failures.
- **SUGGESTION** — optional improvement.
- **PASS** — area reviewed, nothing found.

Overall status in the report:

- `PASS` — no BLOCKING and no IMPORTANT findings.
- `REVIEW` — IMPORTANT findings but no BLOCKING findings.
- `BLOCKING` — at least one BLOCKING finding.

Only report findings you can tie to a specific file and line or to a specific
check output. If you are unsure, say so and label it IMPORTANT at most. Never
report a check as passed if you did not see its output.

---

## 2. CamCash data rules (owner-stated — do not change them)

Flag PRs that appear to contradict these rules.

| Rule | Definition |
|---|---|
| Session gap | A new session starts after a **60-minute** gap between tips |
| Whale | **$100+ total OR 100+ tips** |
| Shark | **5+ tipping sessions** |
| Best-time earnings/hour | **Total USD ÷ actual streamed hours** (never rank by total earnings alone) |
| BongaCams | **$0.025 / token** |
| Chaturbate | **$0.05 / token** |
| MyFreeCams | **$0.05 / token** |

Also enforce the formula rules in `CLAUDE.md/project-and-code-requirements`:
single implementation per formula (import, never copy), token rates only via
`tokenRate()`, USD priority (trusted USD → tokens × rate → 0 + flagged),
fan key = `platform + ":" + normalizedUsername` (never merge fans across
platforms by username alone), user-local timezone for creator-facing hours and
days (`scripts/check-timezone.mjs` baseline may only go down), "Not enough data
yet" instead of invented numbers, no `$0`/`NaN`/`undefined`/`Invalid date` as
primary dashboard content.

### Known pre-existing discrepancies (as of this file's creation)

The code on `main` currently differs from some owner-stated rules above. These
are **not** caused by new PRs. Do not report them as findings on PRs that do
not touch them. If a PR **touches** one of these areas, note the discrepancy
under *Data / Analytics Findings* as IMPORTANT, state what the code does versus
the owner-stated rule, and say the owner must decide. Do not propose silently
"fixing" either side.

1. **Session gap** — `lib/analytics/sessions.js` (`SESSION_GAP_MS = 3 * 60 * 60 * 1000`)
   and `app/dashboard/page.js` (a local `SESSION_GAP_MS = 3 * 60 * 60 * 1000`)
   use **3 hours**, not 60 minutes. The dashboard copy is also a duplicate of
   shared logic.
2. **Whale / Shark** — `lib/analytics.js` assigns tiers by spend percentile
   (Whale = top 5%, Shark = top 20%). `CLAUDE.md/project-and-code-requirements`
   says Whale = `totalUSD >= 100 AND manualTipCount >= 10`, Shark =
   `totalUSD >= 30 AND manualTipCount >= 5`. Neither matches the owner-stated
   rule ($100+ OR 100+ tips; 5+ tipping sessions).
3. **Free tier** — `CLAUDE.md/project-and-code-requirements` also lists
   "3 CSV uploads max / 500 tip cap". Code (`lib/planLimits.js`) implements
   3 platforms + 31-day window. Treat `lib/planLimits.js` plus section 3 below
   as current.

If a PR changes any of these values or formulas, that is BLOCKING unless the
PR description explicitly says the owner approved the change.

---

## 3. Free / Pro / Trial entitlements

| | Free | Pro | Trial |
|---|---|---|---|
| Connected platforms | up to 3 (`FREE_PLATFORM_LIMIT`) | unlimited | Pro |
| Dashboard analysis window | 31 days (`FREE_ANALYSIS_WINDOW_DAYS`) | full history | Pro |
| Top Fans shown | 3 | 10 | Pro |
| Whales shown | 3 | 5 | Pro |
| Cross-platform analysis | basic | deeper | Pro |

A trial is Pro access: the Stripe webhook sets `plan: 'pro'` for `trialing`.
Live Mode is **not** Pro-only; flag copy or gating that presents it as Pro-only.

Check for:

- UI-only gating with no server/database enforcement (UI gating is not security).
- New hard-coded limits instead of importing from `lib/planLimits.js`.
- Plan checks scattered in components instead of shared helpers.
- `plan`/`subscription_status`/`trial_ends_at` read from the client or request
  body instead of the server-side profile.
- Free users able to reach Pro data through an API route, query parameter,
  local storage, or a skipped check.
- Pro/trial users wrongly downgraded (e.g. `trialing` treated as free,
  `past_due` handling changes, expired `trial_ends_at` still granting Pro).
- "Payment locked" vs "Data locked" copy mixed up ("Upgrade to unlock" vs
  "Add more history"); asking for payment for an insight that cannot be
  calculated yet.

---

## 4. Stripe

For changes touching checkout, subscriptions, trials, webhooks, plan state,
payment state, or upgrades, check:

- Webhook signature verification is still performed on the raw body.
- Plan is only upgraded after server-confirmed Stripe state (webhook or server
  retrieval), never from a client redirect or query string alone.
- `subscription_status` carries Stripe's real status (not collapsed to
  `active`); cancellation/deletion downgrades correctly.
- User resolution (customer id → user id) cannot attach a subscription to the
  wrong user.
- Idempotency: replayed webhook events do not corrupt state.
- Price IDs and secrets come from environment variables, never hard-coded.
- Trial claims in UI copy match what checkout actually configures.

Report only. Never suggest committing Stripe secrets or test keys.

---

## 5. Supabase / security

- Service-role client (`SUPABASE_SERVICE_ROLE_KEY`) used only in server code;
  never imported into a client component or a file with `'use client'`.
- Any secret (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  service role key, Anthropic keys) in client code, `NEXT_PUBLIC_*` variables,
  logs, error responses, or committed files → BLOCKING.
- Committed env files (for example a tracked `env.local`, `.env*`) containing
  secrets → BLOCKING. Do not quote secret values in the review.
- `user_id` must come from `supabase.auth.getUser()` server-side, never from the
  request body/query.
- New tables must enable RLS with policies scoped to `auth.uid() = user_id`.
  Disabling RLS or adding permissive policies (`using (true)`) → BLOCKING.
- No `select *` on sensitive tables; queries filter by the authenticated user.
- Admin routes are role-checked server-side (`lib/adminAuth.js`), not hidden in UI.
- Tip data must never be deleted/overwritten; inserts go through the
  `insert_tips_dedup` RPC.
- Fan usernames, tip amounts and earnings are sensitive financial data: check
  they are not exposed across users, in public pages, logs, or third-party calls.
- Raw database errors must not be returned to users.
- Input validation: platform allowlist, date ranges, paste size limits, amounts.

---

## 6. Analytics event tracking

Funnel events the owner tracks:

`signup`, `onboarding_started`, `platform_selected`, `import_started`,
`import_completed`, `results_viewed`, `pro_preview_viewed`, `upgrade_click`,
`checkout_started`, `trial_activated`, plus `onboarding_import_failed` and
`checkout_failed`.

At the time this file was written only some of these names appear in the code
(`signup`, `upgrade_click`, `onboarding_import_failed`). If a PR adds or edits
funnel events, check:

- Duplicate firing (effects without guards, React Strict Mode double-invoking
  effects in development, re-renders, multiple helpers firing the same event).
- Events firing too early: `checkout_started` before a checkout session is
  actually created successfully; `import_completed` before the server confirms
  the import; `trial_activated` without backend (webhook/profile) confirmation.
- Failure events (`onboarding_import_failed`, `checkout_failed`) fire on real
  failure paths.
- No PII or raw data in event properties: emails, fan usernames, raw tip rows,
  exact earnings, pasted CSV content.
- Reuse of the existing helpers (`lib/track.js`, `lib/tracking.js`,
  `lib/analytics-client.js`) rather than a new tracking path.

Do not make claims about conversion performance. Report observable issues only.

---

## 7. UI / UX and visual consistency

Compare against the existing CamCash UI and the brand section of
`CLAUDE.md/project-and-code-requirements` (palette, page background, card
style, primary button). Existing direction: deep navy backgrounds, glass-style
cards, subtle corner glow, cyan/blue/purple/pink gradient accents, restrained
neon, crisp visuals, strong typography hierarchy, consistent card system and
spacing, clear CTA hierarchy.

Flag: inconsistent card dimensions, spacing or border radii; excessive glow;
blurry or low-resolution assets; generic SaaS/default Tailwind styling; white or
flat-gray cards; oversized empty areas; key numbers too small; weak hierarchy;
inconsistent buttons or typography; new one-off visual patterns; confetti.

Also check: loading, empty and error states; focus states and keyboard access;
colour contrast; alt text; modal focus trapping and escape; overflow and
clipping; mobile behaviour; features or UI elements removed without stated
owner approval.

Onboarding / upgrade UI: is the next action obvious; is the value proposition
clear; are metrics readable; are transitions and progress states coherent; do
insights disappear unexpectedly; are trial claims accurate; is Live Mode
correctly shown as not Pro-only; are Free/Pro differences accurate.

### Visual testing

Target viewports: 1440×900, 1280×800, 390×844. The repository has no
Playwright/browser test setup for the web app (Playwright exists only under
`chrome-extension/tests/` for the extension), the review workflow does not
start the app, and dashboard pages need an authenticated account. Unless the
workflow is later extended to render pages, write exactly:

> Visual review not performed because the review workflow does not render the
> app in a browser (no web-app browser tooling or test login is configured).
> UI findings below are from code review only.

Never claim a screenshot, console check, or visual check that was not performed.

---

## 8. Build / test / lint

The workflow runs the repository's own commands (the same ones as
`.github/workflows/build-check.yml`) before the review and saves results in
`.camcash-review/`. Read `.camcash-review/summary.md` and the per-check logs.
Report each check as passed, failed (with the key error lines), or skipped.
Do not invent commands. There is currently no `lint` script in
`glowmetrics_fresh/package.json`; report lint as "not configured" if skipped.

---

## 9. Performance and edge cases

Flag: N+1 or unbounded Supabase queries; loading full tip history into the
client unnecessarily; expensive work in render paths without memoisation;
large new dependencies; missing pagination. Edge cases: zero tips, one tip,
single session, multiple platforms, mixed currencies/tokens, DST boundaries,
non-UTC timezones, very large imports, expired trials, canceled subscriptions.

---

## 10. Report format

Post exactly one top-level PR comment in this format (omit *UI / UX Findings*
when the PR has no UI changes):

```markdown
# CamCash PR Review

## Status

PASS / REVIEW / BLOCKING

<one or two sentences explaining the status>

## Blocking Issues

- **BLOCKING** — `path/to/file.js:123`
  - Problem: …
  - Why it matters: …

(or "None.")

## Important Issues

(same structure, or "None.")

## UI / UX Findings

(viewport/state when available; include the "Visual review not performed
because…" line when applicable)

## Data / Analytics Findings

## Security Findings

## Build / Test Results

| Check | Result |
|---|---|
| npm ci | … |
| lint | … |
| verify-estimated-hourly-rate | … |
| check-timezone | … |
| npm test | … |
| npm run build | … |

## What Looks Good

## Recommended Next Actions
```

Keep it actionable and concise. SUGGESTION items may be listed under the
relevant findings section. Inline comments on specific lines are allowed for
BLOCKING and IMPORTANT findings only.
