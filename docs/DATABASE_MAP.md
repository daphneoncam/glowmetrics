# Database Map — Plain English

**What is a "database"?** Think of it as a giant, extremely organized filing cabinet. Each drawer is called a **table**. Each table holds one kind of thing (e.g., "tips," "user profiles"). Each folder inside a drawer is a **row** — one record, like "the $5 tip that fan123 sent you on July 4th at 9:03pm." Each row has the same set of labeled fields, called **columns** (e.g., `username`, `tokens`, `usd`, `date_time`).

This project's filing cabinet is hosted by a company called **Supabase**, which is really just "a website that runs a Postgres database for you and gives you a login system for free." Your database's internal name (its "project ID") is `hlsdlaibnayzbfflxclj`.

**How I verified this document:** I connected directly to your live, real, production database (read-only — I did not change anything) and asked it to list every table, every column, every security rule, and every piece of automatic logic it runs. Everything in this document describing table/column names, security rules, and database functions is **Confirmed by reading the live database directly** — this is the strongest form of confirmation in this audit, stronger than reading application code, because it reflects exactly what's really there today, not what a file *says* should be there.

---

## ⚠️ Important finding before anything else: your database has grown far beyond what's saved in your code repository

Your database has a built-in history log of every structural change ever made to it ("migrations"). That log shows **51 migrations** have been applied to your real database over time.

Your code repository only has **8 of those migrations saved as files** (7 in `glowmetrics_fresh/supabase/migrations/`, 1 in the older root-level `supabase/migrations/`).

**In plain terms:** more than 40 changes to your database's structure — including creating entire tables — were made directly against the live database (most likely through the Supabase website's dashboard, or through a different tool/session) and were **never saved into your GitHub repository**. This means:

- If you ever needed to rebuild your database from scratch using only what's in GitHub, you would get a much smaller, older, and broken version of it (missing 17+ tables and most of your automatic dedup/security logic).
- Nobody looking at your GitHub repo today — including a future AI assistant — can fully trust it to describe your real database. This document, built from a live read of the actual database, is the more trustworthy source going forward.

📌 **Confirmed.** This is the single most important structural risk in this audit, and it's listed again in the final summary document.

I also found one more piece of evidence of this drift: a migration file at `supabase/migrations/20260606_add_stripe_to_profiles.sql` says it adds two columns (`stripe_customer_id`, `plan_expires_at`) to the `profiles` table — but I confirmed directly against the live database that **neither column exists on `profiles` today**. Either that migration was written but never actually run against production, or the columns were added and later removed by someone working directly in the database. I can't tell which from the files alone. 🏷️ **Unknown — needs your clarification.**

---

## How to read this document

For each table, I list:
- **What it stores**, in plain English, with an example
- **Important columns**
- **Who can see/change it** (the security rule, explained below)
- **Whether it's actually being used** (row count as of this audit, July 2026)

### What is "Row-Level Security" (RLS)?

Normally, if your website's code has a bug, it might accidentally show User A's private tips to User B. Row-Level Security is a second, independent lock that lives **inside the database itself**, not in your website's code. Even if your website's code is completely broken or hacked, the database itself will refuse to hand back rows that don't belong to the person asking.

The rule almost every table in this project uses is:
> "You may only see/edit/delete a row if the row's `user_id` column matches your own logged-in identity."

I'll call this the **"own rows only"** rule below, since it repeats constantly. Every table in your database has this security switch turned **on** (`rls_enabled: true`) — that part is good practice and consistently applied. ✅ **Confirmed.**

---

## Tables that store your users' private financial/personal data

### `tips` — the core earnings ledger — 185,162 rows (by far your biggest table)
**What it stores:** Every single tip/payment event a user has ever imported or captured, across every platform (Chaturbate, BongaCams, MyFreeCams, etc.). One row = one tip.
**Example row (illustrative, not real data):** `user_id: <you>, date_time: 2026-07-04 21:03, platform: Chaturbate, username: fan123, tokens: 100, usd: 5.00, tip_type: Tip`
**Important columns:**
- `usd`, `tokens` — the money and token amount for that tip
- `username`, `username_lower` — the fan's name (a computed lowercase copy exists automatically for fast matching, and notably is **not** combined with platform — see the Metrics Audit document for why that matters)
- `tip_seq`, `upload_id`, `session_id`, `tip_ref` — bookkeeping fields used only for duplicate-prevention and linking back to the upload/session that created the row
- `usd_rounded` — an automatically-computed copy of `usd` rounded to 2 decimals, that exists purely so the database's duplicate-prevention rule (below) has something exact to compare
**Security:** "own rows only" for reading, inserting, and — notably — **deleting**. A user can delete their own tip rows via the app (see "Duplicate/Deletion rules" below).
**Feeds:** Every single earnings metric in the Metrics Audit document reads from this table.
**Private data here:** Yes — this table effectively is your users' financial history.

### `live_tips` — real-time tip capture — 275 rows
**What it stores:** Tips captured live, moment-by-moment, either by the Chrome extension watching a cam site's chat, or by the "Live Mode" page. This is a short-lived staging table — it's meant to feed the live, in-the-moment dashboard, and (for paying users only, see below) some of its rows get automatically copied into the permanent `tips` table.
**Important columns:** `deduplication_key` (a unique fingerprint per tip, used to silently ignore exact repeats), `source` (defaults to `'manual'`), `session_id` (links to `live_sessions`).
**Security:** "own rows only," all actions combined into a single rule.
**Confirmed real behavior (see below, "Automatic Database Logic"):** whether a live tip becomes permanent history depends on the user's paid plan.

### `paid_sessions` — 29 rows
**What it stores:** BongaCams-specific "paid session" events (private shows, etc.) — separate from ordinary tips because BongaCams reports them differently. Completely separate ledger from `tips`, by design (confirmed in code comments in `lib/analytics.js`: "Completely separate from tip analytics — never mixed").
**Important columns:** `session_type`, `usd`, `tokens`, `session_ref` (a de-dup key).

### `csv_uploads` — 37 rows
**What it stores:** A log of every CSV/paste import a user has run — one row per import batch, with totals (`total_rows`, `inserted_rows`, `skipped_rows`, `total_usd`, `total_tokens`) and status. This is the audit trail that also powers the "you've used 2 of 3 free uploads" limit.

### `upload_sessions` — 0 rows (appears unused)
**What it stores:** Looks like an earlier version of `csv_uploads` (same idea: `file_name`, `month`, `year`, `total_rows`). The `tips` table still has a live foreign-key link to it (`tips.session_id → upload_sessions.id`), but it currently holds **zero rows** in production. 🏷️ **Likely legacy/superseded by `csv_uploads` — flagged as possibly dead, not confirmed.**

### `upload_tracking` — 0 rows (appears unused)
**What it stores:** By name and columns (`month_year`, `upload_count`), this looks like it was meant to track the free-tier "3 uploads/month" limit — but it has zero rows, meaning either it's not actually being written to, or that limit is tracked elsewhere (I found the free-tier *platform* limit enforced in the database — see below — but did not find code actively writing to this specific table). 🏷️ **Unknown — worth asking whoever built the free-tier upload cap.**

### `stream_sessions` — 0 rows, and `fan_events` — 0 rows
**What they store:** An older, more elaborate session-tracking design (viewers, new followers/subscribers, goal type, "game," etc.) mentioned in your `setup.sql` as "Optional Advanced Analytics Tables." Zero rows in production — this looks like a feature that was designed but never wired up, or was replaced by the newer `live_sessions`/`saved_live_sessions` tables. 🏷️ **Likely unused/superseded — not confirmed as dead, since a code path could still write to it that I didn't find.**

### `live_sessions` — 0 rows, `saved_live_sessions` — 0 rows
**What they store:** The live-streaming session tracker used by the `/live` page today (started_at/ended_at, goal, totals, top tipper for that session). `saved_live_sessions` appears to be where a session goes once you end it and choose to keep it. Both are empty right now, meaning either this is a newer feature not yet used by real users, or sessions aren't being saved as expected. 🏷️ **Assumption** that this is simply "not used yet" rather than broken — I did not test the live product.

### `subscriber_stats` — 0 rows and `stream_schedule` — 0 rows and `user_goals` — 0 rows
Small supporting tables (subscriber counts over time, a weekly streaming schedule, and user-set income goals). All empty in production today — either unused features or features nobody has used yet.

---

## Tables about people (accounts, billing, admin)

### `profiles` — 87 rows
**What it stores:** One row per registered user — display name, subscription **`plan`** (defaults to `'free'`), marketing-attribution columns (which ad/link they signed up from), and Chaturbate-specific fields (`chaturbate_username`, `broadcaster_type`).
**Security:** own rows only, for select/insert/update. No delete policy exists — a user cannot delete their own profile row through the normal app (this matches there being no account-deletion feature — see the User Flow Map).
**Missing columns I expected but didn't find:** `stripe_customer_id`, `plan_expires_at` (see the drift warning above), and `chaturbate_stats_token` (a field the onboarding-flow research found being written to `profiles` from an apparently-orphaned page, `app/onboarding/chaturbate/page.js` — but that exact column doesn't exist on the live table either). 🏷️ **Unknown/discrepancy — flagged for your review.** If that page is genuinely reachable by users today, it may be silently failing to save that data.

### `beta_users` — 21 rows
**What it stores:** One row per signed-up user, tracking `onboarding_complete` (a true/false flag your whole app relies on to decide "send this person to onboarding vs. the dashboard"), `email`, `signed_up_at`, `csv_upload_count`.
**Security:** A user can insert/update only their own record — but there's also a policy called **"Anyone can read count"** that allows **anyone** (including logged-out visitors) to `SELECT` from this entire table.
🔴 **Confirmed security concern:** because this policy has no row filter (`qual: true`), and the table includes a real `email` column, this means, in principle, any client using your public "anon" API key could read every user's sign-up email address and onboarding status from this table — not just a count. The policy's name ("Anyone can read count") suggests the intent was to let the public website show something like "1,234 people have joined" without exposing who they are, but as written, the rule doesn't limit what's returned to a count — it exposes full rows including email addresses. I did not test this against the live API (that would mean actually pulling user data, which I was told not to do), so I'm reporting the rule as written, not a demonstrated exploit. 🏷️ **Confirmed by reading the database's actual security rule — practical exploitability not tested. Recommend fixing this soon.**

### `subscriptions` — 0 rows
**What it stores:** Stripe billing state — plan type (`free`, `early_adopter_monthly`, `early_adopter_annual`, `standard_monthly`, `standard_annual`), billing cycle, Stripe customer/subscription/price IDs, whether the price is "locked" for early adopters. Zero rows currently, meaning **no user has an active paid Stripe subscription recorded in the database right now** (or this table isn't being written to yet). 🏷️ **Confirmed via live read that the table is empty; whether that means "nobody has paid yet" or "the write path is broken" is an open question for you.**
**Security:** own rows only for select/update — no insert or delete policy, meaning rows must be created by server-side code using elevated database access (that's expected and appropriate for billing data).

### `tipper_notes` — 0 rows
**What it stores:** Your CRM notes about individual fans/tippers — free-text notes, a "follow up" flag, contact preference. Empty in production.

---

## Tables about product analytics, feedback, and marketing (not financial)

- **`analytics_events`** (214 rows) — general product-usage tracking events (button clicks, page views), each optionally tied to a `user_id`.
- **`name_generator_analytics`** (90 rows) — anonymous usage stats for the "cam name generator" tool. Publicly readable and writable by anyone (`allow_public_select`/`allow_public_insert`, both `qual: true`) — appropriate here since it holds no personal data (just `mode`, `niche`, `style`, a count).
- **`feedback`** (6 rows) — messages submitted through the in-app feedback widget. Anyone can insert; only rows can be read by a caller whose login token carries a custom `role: admin` claim (see below — I could not confirm any real account actually has this claim set).
- **`onboarding_exit_feedback`** (4 rows) — records of users who left onboarding early and said why.
- **`notifications`** / **`notification_replies`** (0 rows each) — an admin-to-user messaging/inbox system. `notifications.sender_type` is restricted by a database-level check to only ever be `'admin_personal'` or `'system'` (a user cannot send themselves a notification as an "admin"), and replies (`notification_replies.sender_type`) can be `'user'`, `'admin_personal'`, or `'system'`, with reply-insert additionally checked to confirm the reply's sender is really the notification's owner.
- **`blog_posts`** (0 rows) — a table clearly designed to hold blog content (`slug`, `title`, `content`, `tags`, `published`), but it's empty. Looking at your actual site code, all ~50 blog articles are hardcoded as individual page files under `app/blog/*/page.js`, not stored in this table. 🏷️ **This table looks unused — your blog is not actually database-driven today, despite this table existing for that purpose.**
- **`transactions`** (0 rows) — this table has a security rule of `transactions_deny_all` (`cmd: ALL, qual: false`), meaning **absolutely nobody** — not even a logged-in owner of a row — can read, write, or delete from it through the normal app connection. Combined with having zero rows and no foreign-key links to any other table, this looks like an abandoned or placeholder table. 🏷️ **Unused/orphaned — not confirmed why it exists.**

---

## Automatic database logic ("triggers" and "functions")

Beyond tables, your database has its own small programs that run automatically whenever certain things happen — independent of your website's code. This matters because **these run even if your website has a bug**, and conversely, **a bug in one of these can affect your data even if your website code is perfect.**

| When this happens | This automatically runs | In plain English |
|---|---|---|
| A new user signs up (`auth.users` insert) | `handle_new_user()` | Creates their `profiles` row automatically (name from their email, plan = `'free'`) |
| A new user signs up | `send_welcome_email_on_signup()` | Fires off a welcome email via a separate email-sending service |
| Someone tries to insert a tip into `tips`, `live_tips`, or `paid_sessions` | `enforce_free_tier_platform_limit()` | Blocks the insert with an error if a free-plan user is trying to track a **second** cam platform (free plan = 1 platform only). This is a real, database-level enforcement — not just a website-side suggestion — which is good practice. ✅ |
| A new row is inserted into `live_tips` | `sync_live_tip_to_tips()` | **Only for paying (`pro`/`unlimited`) users** — copies that live tip into the permanent `tips` table, with duplicate-checking. Free users' live tips stay in `live_tips` only and are not kept permanently. |
| `live_sessions.updated_at` needs refreshing | `touch_updated_at()` | Simple timestamp bookkeeping |

### The two most important calculation functions live *inside the database*, not just in your website code

- **`insert_tips_dedup(tips, upload_id)`** — this is the *only* correct way tips are supposed to enter the `tips` table from an import. It takes a batch of tip rows, works out the USD-vs-tokens conversion itself (hardcoded rates: BongaCams `0.025`, everything else `0.05` — matching `lib/constants.js`, but as a **separate, manually-copied value**, because a database function cannot read a JavaScript file), assigns a de-dup sequence number, and inserts — silently skipping anything that matches an existing row's `(user_id, username_lower, tokens, usd_rounded, date_time, tip_seq)` combination.
- **`get_user_insights(user_id, timezone)`** — a large function that independently recalculates "best hour," "best day," "best platform," session-length sweet spot, streaks, and several other insight numbers **directly in SQL**, separately from the JavaScript calculations in `lib/analytics.js`. I confirmed this function exists and is substantial (150+ lines of SQL). **This means some of your most important numbers may be calculated in two completely independent places — once in the database, once in your website code — and I could not confirm they always agree.** See the Metrics Audit document for a formula-by-formula comparison. 🔴 **Confirmed duplicate implementation — flagged as a real risk of "different pages showing different numbers."**

### Duplicate-prevention rules, precisely

The real, working duplicate-prevention key for tips is:
```
(user_id, username_lower, tokens, usd_rounded, date_time, tip_seq)
```
Two tip rows are only treated as duplicates if **all six** of those match exactly. This is different from what your own `standing-instructions` file describes ("unique index on `tip_ref`") — a `tip_ref` column and a *separate* unique index on `(user_id, tip_ref)` does exist too (used only by one ingestion path, the Chaturbate Events API), but it is not the main mechanism most tips go through. 🏷️ **Confirmed discrepancy between your written rule and the actual mechanism — see Metrics Audit for the full picture.**

### Deletion rules — a direct conflict with your own written rule

Your `standing-instructions` file says: *"The `tips` table must never have data deleted or overwritten."*

I found two database functions that do exactly that, by design, as a real user-facing feature:
- **`delete_upload(upload_id, user_id)`** — permanently deletes every tip row belonging to a specific import, plus the import's log entry.
- **`delete_upload_month(upload_id, user_id, month)`** — permanently deletes just one month's worth of tips from within a specific import.

Both check that the calling user actually owns the upload before deleting (good), and both are almost certainly the mechanism behind a "remove this import" button somewhere in your dashboard.

🏷️ **This needs your judgment call, not mine:** the written rule likely meant "an AI assistant/agent must never delete tip data," not "a user must never be allowed to remove their own bad import." But as literally written, the rule and the real feature contradict each other. I'm flagging it rather than assuming which one is "correct."

---

## Quick reference: which tables hold what kind of risk

| Table | Holds private financial data? | Holds personal info (email, etc.)? | Affects a shown metric? | Affects Live Mode? | Affects billing? |
|---|---|---|---|---|---|
| tips | ✅ | — | ✅ (almost everything) | via live mirror | — |
| live_tips | ✅ | — | ✅ | ✅ | — |
| paid_sessions | ✅ | — | ✅ (separate BongaCams metrics) | — | — |
| csv_uploads | — (log only) | — | ✅ (upload counters) | — | (free-tier upload cap) |
| profiles | — | ✅ (name, Chaturbate username) | — | — | ✅ (plan field) |
| beta_users | — | 🔴 ✅ (email, publicly readable — see above) | — | — | — |
| subscriptions | ✅ (billing) | — | — | — | ✅ |
| tipper_notes | — | ✅ (private notes about fans) | — | — | — |
| analytics_events | — | possibly (tied to user_id) | — | — | — |

---

## What I could not verify

- Whether the missing `stripe_customer_id`/`plan_expires_at`/`chaturbate_stats_token` columns are truly never written anywhere, or whether some other, untracked database change re-added them under different names.
- Whether the `beta_users` "Anyone can read count" policy has actually been exploited or noticed — I only confirmed the rule as written.
- Why `upload_sessions`, `upload_tracking`, `stream_sessions`, `fan_events`, `stream_schedule`, `subscriber_stats`, `user_goals`, `blog_posts`, and `transactions` are all empty — unused-but-intentional (future feature), abandoned, or broken-and-silently-failing all remain possible; I did not run the live product to distinguish these.
