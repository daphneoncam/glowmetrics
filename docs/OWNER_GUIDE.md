# Owner's Guide to CamCash — Plain English

This is your starting point. Read this first, then dig into the other four documents in this `docs/` folder for the deep detail:
- `METRICS_AUDIT.md` — every number your product shows, traced from raw data to screen
- `DATABASE_MAP.md` — every table in your database, explained
- `USER_FLOW_MAP.md` — every step-by-step thing a user can do
- `TECHNICAL_GLOSSARY.md` — every technical word translated, plus the final risk summary

**How this guide was built:** I read through your actual code and connected directly (read-only) to your real, live database. I did not guess. Anywhere I wasn't sure, I've labeled it clearly as an assumption or unknown rather than stating it as fact.

---

## What this product does

**CamCash** (your public brand is also shown as "Pretty Profitz" for the browser extension half of the product) is a website that helps cam models — people who stream on sites like Chaturbate, BongaCams, and MyFreeCams — understand their own earnings. In plain terms: cam platforms give their models very little in the way of useful reporting. CamCash lets a model import their tip history (by uploading a file or pasting text), or capture it live while they're streaming, and then shows them things like:

- How much they've earned overall, and per platform
- Which day of the week and which hour of the day earns them the most
- Who their most valuable fans are, and which ones seem to be drifting away
- A live, real-time view while they're actually streaming

It's a subscription product — free with limited features, or paid ("Pro") for the full experience.

---

## How the whole application works, beginning to end

```
1. A visitor lands on your marketing site and signs up
        ↓
2. Onboarding: they pick a platform, and either paste their tip history
   or upload a CSV file
        ↓
3. Your website's server reads that file/text, figures out each individual
   tip (date, fan name, amount), and saves the good ones into your database
        ↓
4. The user is sent to their Dashboard
        ↓
5. The Dashboard pulls that user's entire tip history back out of the
   database and runs it through your calculation engine
        ↓
6. The calculation engine works out totals, best day/hour, top fans,
   whale/shark/dormant tiers, and dozens of other numbers
        ↓
7. Those numbers are drawn on screen as charts, tiles, and lists
        ↓
8. If the user goes live-streaming, a second, real-time path captures
   tips moment-by-moment (either through the Chrome extension watching
   the cam site, or other server-side connections) and shows a live
   version of these same kinds of numbers
        ↓
9. If the user upgrades to Pro, Stripe (a payment company) handles their
   card details directly — your server never sees the card number — and
   tells your server "this person paid," which unlocks the full product
```

---

## What each major folder does

Your code lives inside `glowmetrics_fresh/` — that's the actual working project; the files sitting at the very top level of the repository (outside that folder) are mostly older notes, a spare zip file, and reference material, not live code.

| Folder | What it holds, in plain terms |
|---|---|
| `glowmetrics_fresh/app/` | Every page of your website, plus every backend "API" endpoint (the behind-the-scenes logic your pages call). Next.js (the framework this is built with) uses the folder structure itself to decide the website's page addresses — a folder named `app/pricing/` becomes the page at `yoursite.com/pricing`. |
| `glowmetrics_fresh/app/api/` | The backend-only logic — things like "receive an uploaded CSV," "check a Stripe payment," "verify an admin login." Nothing in here is directly visible on screen; these are the "kitchen," not the "dining room," of your restaurant analogy. |
| `glowmetrics_fresh/app/dashboard/` | The main logged-in dashboard experience — by far the largest and most complex part of your product. |
| `glowmetrics_fresh/app/onboarding/` | The new-user setup flow (pick a platform, import your first data). Contains the file your own project rules flag as "never touch casually." |
| `glowmetrics_fresh/app/live/` | The real-time "I'm streaming right now" experience. |
| `glowmetrics_fresh/app/blog/`, `guides/`, `tools/` | Your marketing/SEO content — dozens of static articles and free tools (a token calculator, a name generator, etc.) meant to bring visitors in from search engines. |
| `glowmetrics_fresh/app/admin/` | Your own private view — signup counts, aggregate stats, a QA preview tool. Not visible to regular users. |
| `glowmetrics_fresh/lib/` | Shared logic used across many pages at once — most importantly, your entire calculation engine (`analytics.js`) and your token-rate rules (`constants.js`). This is the closest thing your project has to a "brain." |
| `glowmetrics_fresh/components/` and `app/components/` | Smaller, reusable visual pieces (buttons, footers, layout wrappers) shared across pages — note there are **two** separate "components" folders in slightly different locations, which is a little confusing but not harmful. |
| `glowmetrics_fresh/supabase/` and the older root-level `supabase/` | Saved records of database structure changes. As explained in `DATABASE_MAP.md`, these are significantly incomplete compared to your real, live database. |
| `glowmetrics_fresh/scripts/` | Small, manually-run helper scripts — not part of the live website itself. |
| `glowmetrics_fresh/public/` | Static files served as-is (images, icons). |
| `chrome-extension/` (top-level, outside `glowmetrics_fresh/`) | Your Chrome browser extension, "Pretty Profitz" — a separate small program that runs inside a user's browser and talks to your website's server. |
| `.github/workflows/` | An automated check that runs every time code is pushed to GitHub — but it **only checks that the website successfully builds**, not that anything actually works correctly. There is no automated testing beyond "does it compile." |

---

## The most important files, and what they do

- **`lib/analytics.js`** — the single biggest piece of "brain" in the whole product. Takes a raw list of tips and calculates nearly every number your dashboard shows: totals, sessions, best day/hour, whale tiers, insights, predictions. Almost everything in `METRICS_AUDIT.md` traces back to this one file.
- **`lib/analytics/sessions.js`** — decides where one streaming "session" ends and the next begins, purely by looking at gaps between tip timestamps. Several other files are supposed to reuse this exact logic and, per this audit, mostly don't.
- **`lib/constants.js`** — the one place your token-to-dollar conversion rates are supposed to live (BongaCams priced lower than the rest). In practice, this exact rate table is also hand-copied in a few other places that can't technically import a JavaScript file (your database functions, your Chrome extension) — see `METRICS_AUDIT.md` for where those copies have drifted.
- **`app/dashboard/page.js`** — the single largest file in the project (over 7,000 lines). It's the main dashboard screen and touches nearly every feature at once: loading data, running calculations, deciding what to show a new-vs-established user, fan management, and more.
- **`app/onboarding/page.js`** — the new-user setup screen. Your own project rules already single this file out as extremely sensitive (it's very large, and certain editing tools can silently truncate a file that size, corrupting it). I did not edit it, and I'd recommend nobody — human or AI — edits it without using a proper code editor/terminal, never a quick web-based editor.
- **`app/api/upload/route.js`** — the real server-side doorway that CSV/pasted tip data passes through on its way into your database.
- **`app/api/live/tips/route.js`** — the real-time doorway for live-streaming tip data.
- **`app/api/stripe/webhook/route.js`** — where Stripe tells your server "this person paid." This audit found a real, concrete bug in this file (see below and `USER_FLOW_MAP.md`).
- **`lib/adminAuth.js`** and **`app/api/auth/admin/route.js`** — your private admin-login system, checked against an email/password stored as server configuration (not in the database).

---

## How the pieces connect to each other

```
                         ┌─────────────────────┐
                         │   Your Website       │
                         │  (Next.js, on Vercel) │
                         └──────────┬────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
       ┌──────▼──────┐      ┌───────▼───────┐     ┌───────▼───────┐
       │  Supabase    │      │    Stripe     │     │    Resend      │
       │ (database +  │      │  (payments)   │     │  (sends emails)│
       │  login/auth) │      └───────────────┘     └────────────────┘
       └──────┬───────┘
              │
       ┌──────▼───────────────┐
       │  Chrome Extension     │
       │ ("Pretty Profitz") —  │
       │  runs in a user's     │
       │  browser, sends live  │
       │  tip data to your     │
       │  website's server     │
       └────────────────────────┘
```

- **Website ↔ Supabase:** every page that needs to check who's logged in, or read/write any real data, talks to Supabase. This is the single most important connection in the whole product.
- **Website ↔ Stripe:** only touched during upgrade/checkout/billing-management, and when Stripe notifies your server about a payment event.
- **Website ↔ Resend:** used to send transactional emails — a welcome email on signup, and notification emails to you personally when someone subscribes or cancels.
- **Chrome Extension ↔ Website:** the extension is a separate piece of software entirely (it doesn't share code with your website); it only talks to your website through the same `/api/live/tips` doorway a logged-in browser tab would use.
- **A quieter, extra connection worth knowing about:** your database itself can also directly call out to the internet on its own (I found it configured to call a Supabase "Edge Function" to send the welcome email) — meaning not every outbound connection in this product originates from your website's own server code; some originate from inside the database.

---

## Which files contain your most business-critical logic

In order of how much of the product depends on them:

1. `lib/analytics.js` — nearly everything
2. `lib/analytics/sessions.js` — session/duration logic that several features assume is shared and consistent
3. `lib/constants.js` — token pricing
4. `app/dashboard/page.js` — the main experience itself
5. `app/api/upload/route.js` and `app/onboarding/page.js` — how real money data enters your system in the first place
6. `app/api/live/tips/route.js` and the Chrome extension files — how real-time money data enters your system
7. `app/api/stripe/webhook/route.js` and `lib/stripe.js` — how you get paid
8. The database functions described in `DATABASE_MAP.md` (`insert_tips_dedup`, `enforce_free_tier_platform_limit`, `sync_live_tip_to_tips`, `get_user_insights`) — real business rules that live inside the database itself, invisible unless you go looking for them specifically

---

## Which files are safe to edit

Generally lower-risk to change, because they're either purely visual, isolated, or don't touch real financial data:
- Anything under `app/blog/`, `app/guides/`, `app/tools/` — marketing/content pages
- `components/ui/Button.js` and similar small, purely visual components
- `app/globals.css`, `tailwind.config.js` — visual styling
- Copy/text changes inside dashboard components, as long as you're not touching the calculation logic itself

## Which files are dangerous to edit

Covered in full, with reasoning, in the "10 files that should never be edited by AI without your explicit, careful review" section at the end of `TECHNICAL_GLOSSARY.md`. In short: `app/onboarding/page.js`, `lib/analytics.js`, `lib/analytics/sessions.js`, `lib/constants.js`, `app/dashboard/page.js`, `app/api/upload/route.js`, `app/api/live/tips/route.js`, `app/api/stripe/webhook/route.js`, anything under `supabase/migrations/`, and your admin-auth files.

---

## Which parts of the project are poorly documented

- **Your database's true structure is not documented anywhere in the repository itself** — 51 real changes exist live, only 8 are saved as reviewable files. `DATABASE_MAP.md` in this folder is, as of today, the most accurate available description of your real database, because it was built by reading the live thing directly.
- **The real, in-production "which dashboard stage is this user at" logic** (`getDashboardReadiness()` in `DashboardPreview.js`) has no comment or documentation explaining its specific thresholds, and doesn't match the differently-named system described in your own written rules.
- **Two onboarding-related pages exist** (`app/onboarding/page.js` and `app/onboarding/chaturbate/page.js`) with no comment anywhere explaining which one is the real, current one.
- **The exact behavior of the free-tier "3 uploads / 500 tip cap"** mentioned in your written rules is not clearly documented in the code — I found tracking/logging but couldn't confirm a hard enforcement point.

## Which parts appear duplicated, outdated, or unused

- **Token conversion rates** — correctly centralized in `lib/constants.js`, but necessarily hand-copied (with explicit "keep in sync by hand" comments) into two database functions and the Chrome extension, since those can't directly import a JavaScript file. One of those copies (the live-tip database trigger) is confirmed out of date for BongaCams pricing.
- **Session-grouping logic** — duplicated at least 4 times with 2 different gap thresholds, despite `lib/analytics/sessions.js`'s own file comment explicitly asking that it never be duplicated.
- **Whale/fan-tier logic** — duplicated 3 times with 3 incompatible definitions.
- **`app/api/auth/login/route.js`** and **`app/api/auth/password-reset/route.js`** — both appear to be unused/dead API routes; nothing in the current website or extension code calls either one.
- **`app/onboarding/chaturbate/page.js`** — appears to be an orphaned, unlinked alternate onboarding page.
- **`upload_sessions`, `upload_tracking`, `stream_sessions`, `fan_events`, `stream_schedule`, `subscriber_stats`, `user_goals`, `blog_posts`, `transactions`** database tables — all currently empty; likely a mix of superseded/replaced designs and not-yet-used features (see `DATABASE_MAP.md` for the full breakdown table-by-table).
- **Two separate `supabase/migrations/` folders** exist in slightly different locations in the repository — mildly confusing, not harmful on its own.
- **Two separate "components" folders** (`app/components/` and `components/`) — same, mildly confusing but not harmful.

## What could cause the application to break

- **Editing `lib/analytics.js` or `lib/analytics/sessions.js` without understanding every place they're called from** — since (per this audit) several other files have their own separate copies of similar logic rather than importing from these files, a change here won't automatically propagate everywhere it should, and could create *new* inconsistencies rather than fixing the existing ones.
- **Editing `lib/constants.js`'s token rates without also updating the hand-copied versions** in your database functions and Chrome extension — this would create a fourth kind of mismatch on top of the ones that already exist.
- **Making database changes directly through the Supabase dashboard website instead of saving them as a migration file** — this is exactly how your database and your GitHub repository ended up out of sync in the first place (see `DATABASE_MAP.md`), and continuing to do this will make the gap worse, not better.
- **Editing `app/onboarding/page.js` with a tool that can silently truncate large files** — your own rules already flag this specifically.
- **Any change to `app/api/stripe/webhook/route.js`** without testing against a real (or Stripe's official test-mode) webhook event — this file already has one confirmed real issue; changes here have direct billing consequences.
- **Disabling Row-Level Security "to fix a data issue"** — your own written rules already warn against this, and it remains true: RLS is the only thing standing between "a website bug" and "one user seeing another user's private data."

---

## Simple overview diagram

```
User action
   ↓
Website receives information   (a page in app/, or an endpoint in app/api/)
   ↓
Code processes it              (parsing, validation — often in lib/analytics.js)
   ↓
Database stores it             (Supabase — mainly the "tips" or "live_tips" table)
   ↓
Metrics are calculated         (lib/analytics.js runs over the stored tips)
   ↓
Dashboard displays the result  (app/dashboard/page.js and its sub-components)
```

---

## A note on how confident to be in this guide

Everything above was built by directly reading your real source code and directly querying your real, live production database (read-only) — not by guessing from file names or documentation. Where I wasn't certain, I labeled it clearly (🏷️ Assumption, ❓ Unknown) rather than stating it as fact. The other four documents in this folder go much deeper on every topic touched on here, with exact file names, line numbers, and — for every important number your product shows — a full trace from raw data to what appears on screen.
