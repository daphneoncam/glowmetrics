# User Flow Map — Plain English

This document walks through every major thing a user can do in CamCash, step by step, showing which page handles it, which files run behind the scenes, what gets saved to the database, what could go wrong, and whether it's covered by any automated test (short answer, for all of them: **no** — this project has no automated test framework installed).

**All file paths are relative to `glowmetrics_fresh/`** unless stated otherwise.

---

## 1. Signup

```
User visits camcashgrl.com (or /landing)
   ↓
Sees a combined signup/login box (defaults to "sign up" mode)
   ↓
Enters email + password, clicks Sign Up
   ↓
Website checks the email isn't a "disposable" throwaway address
   ↓
Website creates the account with Supabase (your login-system provider)
   ↓
 ┌─── If your Supabase project requires email confirmation ───┐
 │  User sees "check your email" → clicks confirmation link    │
 │  → lands back on the site → sent to Onboarding              │
 └───────────────────────────────────────────────────────────┘
 ┌─── If email confirmation is off (immediate login) ──────────┐
 │  User is sent straight to Onboarding                        │
 └───────────────────────────────────────────────────────────┘
```

**Which page handles it:** ⚠️ Not `app/login/page.js` — that file is a bare 4-line redirect to `/landing`. The real signup form lives inside `app/landing/LandingClient.js` (a 1,579-line file), shown both at `/landing` and at the site root `/`.
**Which files run:**
- `app/landing/LandingClient.js` — the form itself, and its `handleAuth()` function
- `app/api/auth/verify-captcha/route.js` — a pre-check for throwaway email addresses (see the "captcha" note below — it isn't really a captcha check right now)
- `lib/supabase.js` — the login-system connection
- `app/api/auth/callback/route.js` — only used if email confirmation is on; this is the page the confirmation link sends the user back to
**What data is created:** A row in Supabase's built-in user table (outside your own tables), which automatically triggers creation of a matching row in your `profiles` table (via the database's own automatic `handle_new_user` logic — see the Database Map). If the user arrived from an ad/link with tracking codes, those get saved onto their `profiles` row too.
**What could fail:**
- A throwaway/disposable email domain is rejected with "Please use a permanent email address to sign up."
- A weak password or duplicate email shows a (mostly) friendly error message.
- If saving the ad-tracking info fails, this is silently ignored — the signup still succeeds, you just lose that marketing data for that user.
**Tests:** ❌ None.
**Something worth knowing:** There's a second, separate signup/login API endpoint at `app/api/auth/login/route.js` built specifically to work with the Chrome extension (it allows requests from `chrome-extension://` addresses). I could not find anything in the current extension code that actually calls it. 🏷️ This looks like either leftover code from an earlier version of the extension, or a hook for a caller that isn't in this repository. Worth asking whoever built the extension.

---

## 2. Login

```
User visits /landing, switches the form to "Log In" mode
   ↓
Enters email + password
   ↓
Website checks credentials with Supabase
   ↓
Website looks up: has this user finished onboarding before?
   ↓
 ┌─ Yes → sent to Dashboard ─┐   ┌─ No → sent to Onboarding ─┐
 └───────────────────────────┘   └────────────────────────────┘
```

**Which page handles it:** `app/landing/LandingClient.js` (same combined form as signup).
**Which files run:** Same as signup, plus a lookup of the `beta_users.onboarding_complete` flag to decide where to send the user next.
**What data changes:** Nothing is written on login — this is a read-only flow (aside from Supabase's own internal session/token bookkeeping).
**What could fail:** Wrong password shows an error message. If the "have you finished onboarding" lookup itself fails for any reason, the code quietly treats that the same as "no, not finished" and sends the user to onboarding again rather than showing a broken page — a reasonable fallback.
**Tests:** ❌ None.

---

## 3. Password Reset

```
User clicks "Forgot password?"
   ↓
Enters their email
   ↓
Website asks Supabase to send a password-reset email
   ↓
User clicks the link in their email
   ↓
Lands on the Reset Password page, sets a new password
   ↓
Redirected to Dashboard
```

**Which page handles it:** `app/forgot-password/page.js` (request the reset) and `app/reset-password/page.js` (set the new password).
**What could fail:**
- Passwords that don't match, or are under 8 characters, are caught before anything is sent to the server.
- If the reset link has expired or is invalid, the page waits about 1.5 seconds to see if a valid "password recovery" session shows up, and if not, shows an "expired link" message with a way to request a new one.
**A note on redundancy:** I found **three separate places** in the code that all independently ask Supabase to send a password-reset email (the dedicated Forgot Password page, an inline version inside the main login form, and a third, standalone API route at `app/api/auth/password-reset/route.js`). The third one appears to be unused dead code — nothing in the site calls it, and it even points the reset link to a web address (`/auth/reset-password`) that doesn't match your real reset page's address (`/reset-password`). 🏷️ Worth cleaning up eventually, low urgency.
**Tests:** ❌ None.

---

## 4. Onboarding

```
New user lands on Onboarding (after signup, or after login if not finished before)
   ↓
Step 1: Pick your platform (Chaturbate, BongaCams, MyFreeCams...)
   ↓
Step 2 (Chaturbate only): Enter your Chaturbate username
   ↓
Step 3: Paste your tip history OR upload a CSV file
   ↓
Step 4: Preview — "we found X tips worth $Y"
   ↓
Step 5: Import runs for real
   ↓
Step 6: Done screen → Dashboard
```

**Which page handles it:** `app/onboarding/page.js` — this is a large, sensitive file that your own project rules mark as **"never touch"** (it must only ever be edited carefully, from a terminal, never through a quick web editor, because it's large enough that some tools can silently cut it off mid-file and corrupt it). I read parts of it only carefully and minimally to document this flow, and made no changes to it, per that rule.
**What data is created/changed:**
- `profiles.chaturbate_username` — saved as soon as the username step is submitted
- `beta_users` — a row is created/updated marking `onboarding_complete = true` only once the import finishes, which is the switch that stops sending this user back to onboarding on future logins
- `tips` — the actual imported tip rows (via the same import path described in the CSV Upload section below)
- `csv_uploads` — one audit-log row per import attempt
**What could fail:** If the account is on the free plan and the user tries to add a *second* different platform (having already imported one), they're shown an upgrade prompt instead of being allowed to proceed — this limit is enforced both in the onboarding page itself and, more importantly, independently inside the database (see Database Map), so it can't be bypassed even if the onboarding page's own check were buggy.
**A related, likely-orphaned page:** `app/onboarding/chaturbate/page.js` is a second, different onboarding page (769 lines) that asks for a Chaturbate "Stats API token" instead of just a username. Nothing else in the site links to it. 🏷️ **Likely dead/legacy — flagged, not confirmed.** Its copy explicitly tells the user "no password required," but it does save what is functionally an API credential into your database — worth a look if it's genuinely unreachable, since unused code that still touches sensitive-looking data is worth cleaning up.
**Tests:** ❌ None.

---

## 5. Platform Selection

This is Step 1 of onboarding (above), so most of it is covered there. The key business rule: **free-plan accounts can track one platform total.** Trying to add a second, different platform (after already having data from a first one) shows an upgrade prompt rather than proceeding. This is enforced in two places — the onboarding page's own check (a UX nicety), and, more importantly, directly inside the database (a real security boundary that holds even if the website's own check has a bug). ✅ Confirmed both layers exist.

---

## 6. CSV Upload

```
User selects a CSV file exported from their cam platform
   ↓
File is sent to the server (app/api/upload/route.js)
   ↓
Server checks: is this really you? (login token required)
   ↓
Server figures out which platform this file is from, and parses every row
   ↓
Server throws out unusable rows (missing date, missing fan name, zero value)
   ↓
Server inserts the good rows into the "tips" table,
  silently skipping any that are exact duplicates of rows already there
   ↓
Server logs a summary of the import
   ↓
User sees "Imported X of Y rows"
```

**Which files run:** `app/api/upload/route.js` (the real server-side endpoint), using shared parsing logic from `lib/analytics.js`.
**What could fail:** An unreadable/empty file returns "No valid rows found." 🔴 **There is currently no file-size limit and no row-count cap on this endpoint** — an extremely large file could, in principle, be slow or resource-intensive to process. (A sibling import route used by the Chrome extension's "scan token history" feature *does* cap at 5,000 rows and checks the platform against an allowed list — that route is more carefully guarded than this one.)
**Tests:** ❌ None.

---

## 7. Copy-and-Paste Import

```
User pastes their raw tip history text into onboarding
   ↓
The page itself (in the user's browser) reads through the pasted text
  and figures out the tips, using its own built-in parser
   ↓
The page builds a preview from what it found, entirely in the browser
   ↓
User confirms → the page converts its already-parsed data into a CSV file
   ↓
That reconstructed file is uploaded through the same path as CSV Upload, above
```

🏷️ **Worth knowing:** your own written project rules describe this differently — they say the raw pasted text should be sent straight to the server, and that the server should be the only place that figures out tips and which platform they're from. What actually happens is the opposite: the parsing and platform detection happen in the user's browser first, and only the already-processed result is sent to the server. This was very likely a deliberate choice by whoever built it (there's a code comment explaining the server's independent parser could "disagree" with what the preview already showed the user, which is a real, sensible concern) — but it means the behavior doesn't match the written rule, and there are now two separate places that know how to read a pasted tip-history file instead of one.
**Tests:** ❌ None.

---

## 8. Import Processing (what happens after either upload method)

```
Raw rows (from file or pasted text)
   ↓
Parsed into structured tips: date, fan name, platform, tokens, dollar value
   ↓
Rows with no date, no fan name, or zero value are thrown away
   ↓
Each remaining row gets a "sequence number" to help detect exact duplicates
   ↓
Rows are sent to the database in batches of 250
   ↓
The database's own "insert_tips_dedup" function does the actual insert,
  silently skipping anything that exactly matches a row already saved
  (same user, same fan, same tokens, same dollar amount, same minute, same sequence)
   ↓
An audit-log row is saved recording how many rows were found/kept/skipped
```

**Where the money conversion happens:** if a row already has a dollar value, that's trusted and used as-is. If it only has a token count, the token count is converted to dollars using the platform's rate (BongaCams is priced lower than the others). This conversion logic exists correctly in three separate places that all need to independently agree with each other — see the Metrics Audit document for the full detail on where they can (and, in one confirmed case, do) disagree.
**Tests:** ❌ None, beyond one hand-run verification script covering a *different* metric (estimated hourly rate), not the import process itself.

---

## 9. Session Creation

There is no explicit "create a session" step for CSV-imported data — the app looks at a user's full tip history and *infers* where one streaming session probably ended and the next began, purely by looking for gaps in time between tips. See the Metrics Audit document (Session Duration section) for the full detail on how this inference works and where it disagrees with your written rules, and across different pages of the dashboard.

**Live streaming sessions are different** — those are explicit and manual: a user clicks "Start Streaming" on the Live page, which creates a real database row (`live_sessions`), and clicking "Stop" ends it. There is no automatic "you've gone quiet for an hour, I'm ending your session for you" behavior for Live Mode — it only starts/stops when the user tells it to.

---

## 10. Dashboard Loading

```
User navigates to /dashboard
   ↓
Page checks: are you logged in? (if not → sent to /landing)
   ↓
Page loads the user's full tip history from the database
   ↓
Page runs the full analytics engine (lib/analytics.js) over that history
   ↓
Page decides which "stage" this user is at (how much of the dashboard to unlock)
   ↓
Charts, tiles, and tabs render using the calculated numbers
```

**Which files run:** `app/dashboard/page.js` (an extremely large file — over 7,000 lines — that is the single biggest piece of logic in the whole product), plus `lib/analytics.js` and its supporting files, plus the various dashboard sub-components (`MoneyMap.js`, `StreamPlanner.js`, `AnalyticsCharts.js`, `DashboardGrowthCharts.js`, `DashboardPreview.js`, `Sidebar.js`).
**What could fail:** A brand-new user with zero tips is shown a "getting started" state rather than a blank/broken dashboard — a deliberate, good design choice confirmed in the code (your rules explicitly say "never show $0, NaN, blank tables as primary content," and the "stage" system exists specifically to honor that, even though — see Metrics Audit #16 — the actual stage logic used doesn't match what you wrote down).
**Tests:** ❌ None.

---

## 11. Metric Calculation

Covered in full, metric-by-metric, in **`METRICS_AUDIT.md`** — that document is the detailed version of this step. Short version: most metrics are calculated by a shared engine (`lib/analytics.js`), but many are *also* separately recalculated by individual dashboard tabs/components with their own, sometimes different, rules — which is the single biggest risk area in this whole audit.

---

## 12. Live Mode

```
User opens the Live page and clicks "Start Streaming"
   ↓
A live_sessions row is created
   ↓
Tips arrive either from:
   (a) the Chrome extension watching the cam site's chat, or
   (b) other server-side integrations reading Chaturbate's own APIs
   ↓
Each tip is saved into the "live_tips" table (short-term, real-time table)
   ↓
Dashboard tiles update live: tonight's total, top tipper tonight, etc.
   ↓
 ┌─ If the account is on a PAID plan ──────────────────────────┐
 │ The tip is ALSO copied into the permanent "tips" table,      │
 │ through TWO separate, independent copy mechanisms that both  │
 │ fire on the same event (see risk note below)                 │
 └────────────────────────────────────────────────────────────┘
 ┌─ If the account is on the FREE plan ────────────────────────┐
 │ The tip stays in "live_tips" only — nothing is kept          │
 │ permanently once it rolls off                                │
 └────────────────────────────────────────────────────────────┘
   ↓
User clicks "Stop Streaming" → the live_sessions row is closed out
```

**Which files run:** `app/live/page.js`, `app/live/EventsSync.js`, `app/api/live/tips/route.js`, plus the Chrome extension (`chrome-extension/background.js`, `content.js`).
🔴 **Confirmed risk:** for paid accounts, the same live tip currently gets written into the permanent `tips` table via **two independent code paths** at once — one directly in the website's server code (with no duplicate-protection at all), and one inside the database itself (which does have its own duplicate-protection). As of this audit, **zero real accounts are on a paid plan with this path active**, so this hasn't visibly caused bad data yet — but it is live, deployed code, and it will run the next time someone upgrades and streams live. See the Metrics Audit document (#13) and Database Map for full detail.
**Tests:** ❌ None.

---

## 13. Browser Extension Data

```
User installs the "Pretty Profitz" Chrome extension (CamCash's extension, under a different public-facing name)
   ↓
User logs in inside the extension's popup
   ↓
While the user has a cam site open in a browser tab, the extension watches
  the page's chat messages in real time for tip-shaped text
   ↓
When it spots one, it sends the tip to CamCash's server
  (the same /api/live/tips endpoint described in Live Mode above)
   ↓
The extension's own popup shows a running local log with sync status icons
```

**Which files run:** `chrome-extension/content.js` (watches the page), `chrome-extension/background.js` (sends data to the server), `chrome-extension/popup.js` (the little window you see when clicking the extension icon).
🔴 **Confirmed gap:** your own project rules say the extension should skip its chat-watching when a user has connected Chaturbate's official "Stats API" directly (to avoid counting the same tip twice, once from each source). I searched the entire extension and found **no such check exists** — it always watches chat, regardless of what else is connected. Combined with the fact that your server has two *other* independent ways of pulling in Chaturbate tip data, this is a real risk of the same real tip being counted 2–3 times for any user who has more than one of these turned on at once.
**Tests:** ❌ None (and by nature, a browser extension is especially hard to test automatically without dedicated tooling, which this project doesn't have).

---

## 14. Subscription and Payment

```
User clicks "Upgrade" on the Pricing page
   ↓
Server creates (or reuses) a Stripe customer record for this user
   ↓
Server sends them to a real Stripe-hosted checkout page
   ↓
User enters card details on Stripe's own page (CamCash never sees the card number)
   ↓
Stripe tells CamCash's server "payment succeeded" via a webhook (a background
  notification, not something the user sees)
   ↓
Server updates the user's plan to "pro"
   ↓
Server sends you (the owner) an email notification of the new subscriber
```

**Which files run:** `app/api/stripe/checkout/route.js` (starts the payment), `app/api/stripe/webhook/route.js` (receives Stripe's confirmation), `app/api/stripe/portal/route.js` (lets an existing subscriber manage/cancel their billing), `lib/stripe.js`.
**Security check performed:** ✅ the webhook correctly verifies Stripe's signature before trusting any payment notification — this is exactly the right, secure way to do it, and matches your own written security rule to "verify Stripe webhook signatures."

🔴 **Confirmed likely bug, not yet proven to have caused a failure in production:** when a payment succeeds, the webhook code tries to save the Stripe customer ID onto the user's `profiles` row — but I directly confirmed, by reading your live database's actual structure, that the `profiles` table **does not have a column for that** (a `stripe_customer_id` column does exist on a *different* table, `subscriptions`, but not on `profiles`, and the webhook writes to `profiles`). Depending on exactly how your database and hosting provider are configured, a write like this can either fail outright (which would mean the whole webhook errors out, and Stripe would keep retrying it) or simply be silently ignored by the database while everything else in that same update succeeds. I was not able to fully determine which behavior your setup produces without either testing a real payment or making a change, and I did neither, per your "no changes" instruction for this audit — so I'm flagging this as a real, code-confirmed issue with an unconfirmed real-world impact. ❗ **Given real money is involved, I'd suggest this is one of the first things you get a developer to check.**
**A related mismatch:** the webhook always sets the plan to the single word `"pro"`, but the separate `subscriptions` table (which does track which specific paid plan someone picked — early-adopter vs. standard, monthly vs. annual) is never updated by the webhook at all, and currently has **zero rows** in your live database. Two users currently show `plan = "pro"` in `profiles` today, 🏷️ which most likely means those were set by hand (for testing) rather than through a real completed Stripe payment, since a real payment would normally have created a `subscriptions` row first (during the checkout step) — and none exist.
**Tests:** ❌ None. Payment flows are exactly the kind of thing worth testing carefully, given real money is involved.

---

## 15. Free versus Paid Access

**What free-plan users can and can't do (confirmed by reading the code and the database):**
- ✅ Track **one** cam platform total (enforced both on-screen and, more importantly, inside the database itself — so it can't be bypassed by a website bug)
- ✅ Live Mode tips are visible in real time but are **not** kept permanently once they roll off
- 🏷️ A "3 CSV uploads, 500 tip cap" limit is described in your written rules — I found the *upload count* being logged (`csv_uploads` table), but I did not find the specific "3 uploads" or "500 tips" numbers actually enforced anywhere as a hard block in the code I reviewed. ❓ **Unknown whether this specific limit is actually enforced today**, versus just tracked/logged.

**Where the paid/free check happens:** Mostly by reading a single word (`profiles.plan`, either `"free"` or `"pro"`) — this check appears consistently as a real, server-side/database-side rule for the platform-count limit and the live-history mirroring, which is good (your rules say "UI gating is not security... every paid feature must be enforced server-side," and that part holds up for those two specific features). I did not find evidence of the same rigor for every single paid feature across the whole dashboard — a full feature-by-feature audit of every paywall would require going through the entire 7,000-line dashboard file screen by screen, which was outside the scope of the automated searches used for this audit. 🏷️ **Assumption, not exhaustively confirmed:** most paywalls are probably UI-only (hide a tab/card) without a matching server-side check, since that's the simpler and more common way to build this kind of gating, and building genuine server-side enforcement for every single premium feature would be unusually thorough. I did **not** verify this claim exhaustively.

---

## 16. Logout

```
User clicks "Log Out" (from the dashboard sidebar or the Live page)
   ↓
The login session is cleared
   ↓
User is sent back to the landing page or login page
```

**Which files run:** Three separate places in the code call the "log out" action — `app/dashboard/page.js` (twice — once as a stray unused call, once wired to the actual sidebar button) and `app/live/page.js`. None of them checks whether the log-out itself succeeded before moving on — 🏷️ a very minor gap; a failed log-out here would just mean the redirect happens anyway, which in practice is unlikely to strand anyone.
**Tests:** ❌ None.

---

## 17. Account Deletion

❌ **This feature does not exist in the product.** I searched the entire codebase specifically for it and found nothing — no button, no page, no API route, no database function that deletes a user's account.

The only place account deletion is mentioned at all is in the **written Privacy Policy text** shown to users (`app/privacy/page.js`), which says: *"If you delete your account, your data will be permanently deleted within 30 days. You can request deletion at any time by contacting us at support@camcashgrl.com."*

**In plain terms: your privacy policy promises a deletion process that only exists as a manual, email-based request today — there is no self-service "delete my account" button anywhere in the product.** Depending on what privacy laws apply to your users (e.g., GDPR, CCPA), this gap between what's promised in writing and what's actually built may be worth addressing. 🔴 This is a genuine compliance-shaped risk, not just a missing feature — flagged for your attention, not something I can assess the legal significance of myself.
