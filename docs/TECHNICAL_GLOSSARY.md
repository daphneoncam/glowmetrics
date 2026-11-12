# Technical Glossary — Plain English

A translation guide for the technical words you'll run into if you read the other audit documents, talk to a developer about this project, or look at the code yourself. Terms are grouped by theme, then there's a full A-Z index at the bottom.

---

## The basic shape of a web app

**Frontend** — everything the user actually sees and clicks on: the buttons, charts, colors, text on screen. In this project, the frontend is built with React and Next.js (see below).

**Backend** — the part of the app that runs on a server, out of sight, handling things the user shouldn't be trusted to do themselves (checking passwords, calculating money totals, talking to the database). In this project, backend code lives mostly in `app/api/` folders.

**Server** — a computer, owned by a hosting company (in this case, Vercel), that runs your backend code and serves your website to visitors. You don't manage a physical server yourself; Vercel handles that.

**Client** — the opposite of "server": your visitor's own web browser, running the frontend code. When you see "client-side" in this audit, it means "happens in the user's browser," and "server-side" means "happens on Vercel's computers, not the user's."

**API (Application Programming Interface)** — a defined way for two pieces of software to talk to each other. When your website's frontend needs data or wants something saved, it sends a request to an API "endpoint" (a specific web address built for that one purpose, like `/api/upload`), and gets a response back. Think of it like ordering at a restaurant counter: you don't walk into the kitchen yourself, you request through a defined window.

**Component** — a reusable, self-contained chunk of frontend code that draws one piece of the screen (a button, a chart, an entire tab). This project's dashboard is built from many components like `MoneyMap.js`, `StreamPlanner.js`, `Sidebar.js`.

**Hook** — a specific kind of reusable function in React (the framework this site's frontend is built with) that lets a component "hook into" things like "remember this value between re-renders" or "run this code when the page first loads." You'll see function names starting with `use` (like `useState`, `useEffect`) — those are hooks.

**Function** — a named, reusable block of code that does one job and can be run ("called") from multiple places. Almost everything in this audit — `detectSessions()`, `tokenRate()`, `identifyWhales()` — is a function.

---

## Databases

**Database** — the organized storage system that holds all your real data permanently (users, tips, subscriptions). See `DATABASE_MAP.md` for the full picture of this project's database.

**Supabase** — the company/service that hosts this project's database and also provides its login system (signup, password reset, sessions). Think of it as "a database plus a bouncer, rented as a service" so you didn't have to build either from scratch.

**Query** — a request sent to the database asking for specific information ("give me all of this user's tips from last month") or asking it to change something ("insert this new tip"). Written in a language called SQL.

**Migration** — a saved, numbered file describing one specific change to the database's structure (e.g., "add a new column," "create a new table"). Migrations are meant to be a complete history log of how your database was built, in order, so it can be rebuilt from scratch if needed. This audit found your project's saved migration history is significantly incomplete (see `DATABASE_MAP.md`) — many real changes were made directly to the live database and never saved as migration files.

**Row-Level Security (RLS)** — a security feature built into the database itself that restricts which rows of a table a given logged-in person is allowed to see or change, enforced by the database, not by your website's code. Explained in more detail, with examples, in `DATABASE_MAP.md`.

**Trigger** — a small program the database runs automatically whenever something specific happens (e.g., "every time a new user signs up, automatically create their profile row"). Triggers run even if your website's own code has a bug, which makes them a powerful but also easy-to-forget-about place for logic to live.

**Webhook** — a way for one system to automatically notify another system the instant something happens, without anyone needing to check back and ask. In this project, Stripe (the payment processor) sends a webhook to your server the moment a payment succeeds or a subscription changes, so your app can react immediately rather than having to constantly ask Stripe "has anything changed yet?"

**Realtime subscription** — a live, always-open connection between the website and the database that pushes updates to the screen the instant new data appears, instead of the browser having to repeatedly ask "anything new?" This is the kind of mechanism that would power a live-updating dashboard tile during a streaming session.

---

## Logging in and permissions

**Authentication ("auth")** — proving *who you are* (logging in with an email and password). Handled by Supabase in this project.

**Authorization** — once we know who you are, deciding *what you're allowed to do or see*. In this project, this is mostly done by checking a single word stored on your account (`profiles.plan`, either `"free"` or `"pro"`), plus the Row-Level Security rules described above.

**Environment variable** — a secret or setting (like a password, an API key, or a web address) that's configured separately from the code itself, so it can be different between your testing setup and your real live website, and so secrets never get typed directly into files that get shared publicly. You'll see these referenced as `process.env.SOMETHING` in the code.

---

## Building and shipping code

**TypeScript** — a stricter version of JavaScript (the programming language this whole project is written in) that catches certain mistakes before the code even runs. 🔍 **Worth knowing:** despite having a `jsconfig.json` file, this project is written in plain JavaScript, not TypeScript — there is no extra type-checking safety net here.

**Build** — the process of taking all your source code and turning it into the actual, optimized files that get served to a visitor's browser. Run with the command `npm run build`.

**Deployment** — publishing a new build of your website so real visitors can see it. This project deploys to Vercel automatically.

**Git branch** — a separate, parallel copy of your code where changes can be made without affecting the main, live version until you're ready. This document was written on a branch, for example, rather than directly on your main branch.

**Pull request (PR)** — a proposed set of changes, submitted for review, before they're merged into the main branch. Your GitHub repository shows a history of many past pull requests, each representing one chunk of work.

---

## Testing (a section worth reading carefully — this project has almost none)

**Unit test** — a small, automated check that one specific function gives the correct answer for a known input (e.g., "does `tokenRate('BongaCams')` really return `0.025`?"). ❌ This project has **zero** unit tests.

**Integration test** — a broader automated check that several pieces of the app work correctly *together* (e.g., "does uploading a real CSV file actually result in the right rows landing in the database?"). ❌ None exist here either.

**End-to-end (E2E) test** — an automated test that behaves like a real user clicking through a real browser (signs up, imports data, checks the dashboard shows the right number). ❌ None exist here.

**Fixture** — a small, fake, prepared piece of sample data used specifically for testing, so a test doesn't depend on real (and possibly private) production data. This project does have some **fixture-like fake data** — but it's used for marketing/demo purposes (the Demo page, the admin preview tool), not for testing.

**Mock** — a fake stand-in for a real piece of the system (e.g., a fake "always succeeds" payment processor), used during testing so tests don't have to depend on a real external service. Not used here, since there's no test suite to use them in.

**What this project has instead:** one hand-written verification script (`scripts/verify-estimated-hourly-rate.mjs`) that a developer has to remember to run manually — it is not run automatically, and only covers one specific formula.

---

## Bugs worth understanding by name

**Race condition** — a bug that only happens because two things tried to happen "at the same time" in an unexpected order (e.g., two processes both trying to insert the same tip a split-second apart, and both succeeding because neither one saw the other's insert in time). This audit found a real, live example of a *structural* risk for this: for paying users, a single live tip currently gets written into the permanent `tips` table through two independent code paths at nearly the same moment — see `METRICS_AUDIT.md` (#13, Live Mode Totals) and `DATABASE_MAP.md`.

**Hydration error** — a specific kind of glitch in frameworks like Next.js where the version of a page first sent from the server doesn't quite match what the user's browser expects to build on top of it, causing a visible flicker, a console warning, or in some cases broken interactivity. Not something this audit specifically tested for (that requires actually running the live site in a browser), but worth knowing the term if you see it mentioned in error logs.

---

## A-Z quick index

| Term | Plain-English meaning |
|---|---|
| API | A defined way for two pieces of software to send each other requests and responses |
| Authentication | Proving who you are (logging in) |
| Authorization | Deciding what a logged-in person is allowed to do |
| Backend | The server-side code the user never sees directly |
| Build | Turning source code into the real files served to visitors |
| Client | The user's own browser, running frontend code |
| Component | A reusable chunk of on-screen UI |
| Database | Organized, permanent storage for your real data |
| Deployment | Publishing a new version of the live website |
| End-to-end test | An automated test that acts like a real user in a real browser |
| Environment variable | A secret/setting kept separate from the code itself |
| Fixture | Fake sample data used for testing (not present here) |
| Frontend | Everything the user sees and interacts with |
| Function | A named, reusable block of code |
| Git branch | A separate, parallel copy of the code for making changes safely |
| Hook | A React function that lets a component "hook into" special behavior |
| Hydration error | A Next.js glitch where server and browser versions of a page don't match up |
| Integration test | An automated test checking multiple parts work together correctly |
| Migration | A saved record of one database structure change |
| Mock | A fake stand-in for a real system, used in testing |
| Pull request | A proposed code change, submitted for review before merging |
| Query | A request sent to the database |
| Race condition | A bug caused by two things happening in an unexpected order at nearly the same time |
| Realtime subscription | A live connection that pushes database updates to the screen instantly |
| Row-Level Security | A database-level rule restricting which rows each person can see/edit |
| Server | The remote computer that runs your backend code and serves your website |
| Supabase | The company hosting this project's database and login system |
| TypeScript | A stricter version of JavaScript that catches certain errors early (not used in this project) |
| Trigger | Code the database runs automatically when something specific happens |
| Unit test | An automated check that one small function gives the right answer |
| Webhook | An automatic notification sent from one system to another the instant something happens |

---

# Final Summary — Read This If You Read Nothing Else

## The 10 biggest risks in the project

1. 🔴 **Your database has grown far beyond what's saved in your GitHub repository.** 51 real structural changes exist in your live database; only 8 are saved as files anyone can review or rebuild from. *(Database Map)*
2. 🔴 **The Stripe payment webhook tries to save data to a database column that doesn't exist**, with real money involved. Not yet proven to have caused a failure (only 2 accounts show `plan=pro`, likely set by hand, and 0 rows exist in your billing-details table), but the code, as written today, is broken in a way that matters. *(User Flow Map, #14)*
3. 🔴 **Fans are never told apart by platform, only by username**, across the entire product. Two unrelated people with the same username on two different platforms get merged into one fan record everywhere — fan counts, whale tiers, churn alerts, CRM notes. *(Metrics Audit, #9)*
4. 🔴 **Whale/Shark/Regular/Dormant fan tiers are calculated three completely different, incompatible ways** depending on which tab you're looking at — the same fan can be a "Whale" on one tab and not on another. *(Metrics Audit, #10)*
5. 🔴 **"Session" boundaries (and therefore session count, session duration, and $/hour) are calculated at least four different ways** across the product, using either a 3-hour or 4-hour gap rule — neither of which matches your own written 60-minute rule, and the written "30 min + 2 tips" validity rule doesn't exist anywhere in the code. *(Metrics Audit, #3–4)*
6. 🔴 **For paying users, a live tip can be written into permanent history twice**, through two independent, simultaneous code paths — one with no duplicate-protection at all. Currently latent (zero paying users have triggered it yet). *(Metrics Audit, #13)*
7. 🔴 **The browser extension has no protection against double-counting tips** when a user also has Chaturbate's own APIs connected — your own rules call for this protection, and it isn't built. *(User Flow Map, #13)*
8. 🟠 **One database security rule (`beta_users`) appears to let anyone read every user's email address and sign-up status**, not just an aggregate count, based on the rule as written. Not tested against the live system, but the rule itself is real. *(Database Map)*
9. 🟠 **"Top Tipper" and "Top Spender" are supposed to be two different rankings and are not** — and one import-preview screen ranks fans by raw token count instead of real dollar value, which can rank a lower-paying fan above a higher-paying one across platforms. *(Metrics Audit, #8)*
10. 🟠 **There are no automated tests anywhere in this project.** Every finding above was only catchable by a human (or an AI) manually reading the code — nothing would have caught these automatically before they reached your real users.

## The 10 most important missing automated tests

1. A test confirming `lib/analytics.js`'s `totalUSD`/`totalTokens` match a hand-calculated answer for a known set of tips.
2. A test confirming the Estimated $/Hour calculation's minimum-session-length is what you intend it to be (currently 15 minutes; your written rule says 30).
3. A test confirming session-splitting uses one single, agreed-upon gap threshold everywhere it's used.
4. A test confirming Whale/Shark/Regular/Dormant produces the *same* tier for the same fan on every tab.
5. A test confirming fan identity is unique per platform (a same-named fan on two platforms should never merge).
6. A test that actually fires a fake Stripe webhook event at your webhook code and confirms the user's plan updates correctly without errors.
7. A test confirming `insert_tips_dedup` truly rejects an exact duplicate tip and truly accepts a genuinely new one.
8. A test confirming the free-tier "1 platform" limit can't be bypassed through any of the three-plus ways tips can enter the database (CSV, paste, live extension, Events API).
9. A test confirming Best Day / Best Hour use the median (not the mean) and require the minimum sample size everywhere they're shown.
10. A basic end-to-end test: sign up → import a small known CSV → confirm the dashboard shows the expected totals.

## The 10 files that should never be edited by AI without your explicit, careful review

1. `app/onboarding/page.js` — your own rules already flag this as extremely sensitive (very large, must never risk silent truncation).
2. `lib/analytics.js` — the single shared calculation engine nearly every number in the product depends on.
3. `lib/analytics/sessions.js` — the shared session-detection logic multiple features silently assume is consistent.
4. `lib/constants.js` — the token-rate "source of truth"; a wrong edit here silently mis-prices every future import.
5. `app/dashboard/page.js` — 7,000+ lines; the largest, most tangled file in the product, touching nearly every feature at once.
6. `app/api/upload/route.js` — the main path real user financial data flows through into your database.
7. `app/api/live/tips/route.js` — the live-money ingestion path, already confirmed to have a duplicate-write risk.
8. `app/api/stripe/webhook/route.js` — real payment/plan logic; a bad edit here has real billing consequences.
9. Any file under `supabase/migrations/` — these change your live database's structure; a mistake here can be very hard to undo cleanly.
10. `lib/adminAuth.js` and `app/api/auth/admin/route.js` — your own admin-login security boundary.

## Where metric results could be wrong

Every metric marked 🔴 or 🟠 risk in `METRICS_AUDIT.md`: Average $/Hour, Session Duration/Count, Platform Earnings, Best Day/Hour (on non-canonical pages), Top Tipper/Spender, Whale/Shark/Regular/Dormant, Live Mode totals, and the Dashboard Stage a user is placed into.

## Where user data could be at risk

The `beta_users` public-read policy (possible email exposure); the Stripe webhook writing to a non-existent column (possible silent billing-sync failure); the fan-merging-across-platforms issue (mixing up two different real people's tip histories and CRM notes); the missing account-deletion feature versus your written privacy-policy promise.

## Where logic is duplicated

Nearly everywhere covered in `METRICS_AUDIT.md` — this is the single most common pattern in the whole audit, not an isolated issue. Token rates alone are hand-copied in at least four separate places (JavaScript, two SQL database functions, and the Chrome extension) with an explicit code comment in each admitting it's a manual, easy-to-forget-to-update copy.

## Areas I could not fully understand or verify

- Whether the onboarding-flow preview (inside the protected `app/onboarding/page.js`) shares the confirmed "ranks by tokens instead of dollars" bug found in the dashboard's re-import preview.
- Why more than a dozen database tables exist with zero rows — genuinely unused, a not-yet-launched feature, or a silently broken write path; I could not tell these apart without running the live product myself.
- Whether the free-tier "3 uploads / 500 tips" limit described in your written rules is actually enforced anywhere as a hard block, versus just logged/tracked.
- The full extent of which premium features have real server-side enforcement versus only a UI-level hide — I confirmed this rigorously for two features (platform limit, live-history mirroring) but did not exhaustively check every paywall across the 7,000-line dashboard file.
- Whether `app/onboarding/chaturbate/page.js` and a couple of other flagged files are truly dead code or reachable through a path I didn't find.

## Questions you, as the product owner, need to answer

1. Should "a user deleting their own bad CSV import" be allowed to delete real tip rows? (Your written rule says tips must never be deleted; a real, working feature does exactly that today.)
2. What was actually intended by the 60-minute session-split rule versus the 3–4 hour gap actually used everywhere — which one is correct, and should every page be made to match it?
3. What are the real, intended dollar thresholds for Whale/Shark/Regular/Dormant — the percentile system, the flat-500-token system, or the dollar-threshold system written in your rules? Right now all three exist simultaneously.
4. Is the free-tier "3 uploads / 500 tips" limit supposed to be a hard block today, and if so, where should it live?
5. Is `app/onboarding/chaturbate/page.js` (the Stats API token page) still meant to be reachable, or should it be formally retired?
6. Do you want a real, self-service account-deletion feature built to match what your Privacy Policy already promises users?
7. Has any real customer ever completed a Stripe payment through this system, or have all `plan = "pro"` accounts so far been set by hand for testing?

## A recommended order for fixing problems

1. **Confirm and fix the Stripe webhook's broken column write** — real money and real customer trust are involved.
2. **Fix the `beta_users` public-read security rule** — a quick, low-effort, high-value fix.
3. **Decide on one single session-splitting rule and one single fan-identity rule (platform + username), then update every place that duplicates that logic to use the shared version instead of its own copy.** This one pair of decisions would resolve the largest number of downstream metric disagreements at once.
4. **Decide on one single Whale/Shark/Regular/Dormant definition** and remove the other two.
5. **Add the Stats-API double-counting guard to the Chrome extension.**
6. **Fix the live-tip double-write path** before your first paying customer streams live.
7. **Write a small number of automated tests** covering the shared calculation engine (`lib/analytics.js`) so future changes can't silently reintroduce these same problems.
8. **Decide what to do about the account-deletion promise** in your Privacy Policy.
9. **Save your database's real, current structure back into your GitHub repository** so the two stop drifting further apart.
