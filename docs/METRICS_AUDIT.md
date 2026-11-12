# Metrics Audit — Plain English

This document traces every important number your product shows — from the raw data a user imports, all the way to the number that appears on their screen — and checks it against the rules written down in your own `standing-instructions` file.

**All file paths below are relative to `glowmetrics_fresh/`** (e.g., "`lib/analytics.js`" means `glowmetrics_fresh/lib/analytics.js`).

## How to read the labels in this document

- ✅ **Confirmed by reading the code** — I opened the actual file and read the actual formula.
- 🗄️ **Confirmed by reading the live database** — I connected directly to your real Supabase database and read its actual structure/rules.
- 🧪 **Confirmed by automated tests** — there is a real, running automated test that checks this. (Spoiler: your project has **no automated test framework installed at all** — no Jest, no Vitest, nothing runs on every code change. This label will appear rarely, and I say so explicitly every time.)
- 🏷️ **Assumption** — reasonable, but I did not verify it directly (e.g., I didn't click through the live website).
- ❓ **Unknown** — I could not determine this from the code or database, and it needs your input.
- 🔴 = High risk · 🟠 = Medium risk · 🟢 = Low risk

## The single most important pattern in this document

Your own `standing-instructions` file says, in writing: *"Every formula has exactly one implementation. Never copy, always import."*

I checked this claim against the code for every metric below. **It is not true today.** Nearly every metric in this document is calculated in 2–6 different places, with different rules, and often gives different answers depending on which page or tab the user is looking at. I show the exact code for each version so you can see precisely where they disagree. This is the single biggest source of "why does this number not match that number" risk in the product, and it shows up over and over below rather than being one isolated bug.

---

## 1. Total Earnings (Total USD)

**Plain English:** The sum of every dollar a user has ever recorded across all their tips.

**Formula (canonical, in `lib/analytics.js:792-793`):**
```
totalUSD = sum of every tip's "usd" value
```
**Numerical example:** 3 tips of $5, $12.50, and $3 → Total Earnings = $20.50.

**Original data source:** Every row in the `tips` database table for that user (🗄️ confirmed table, 185,162 real rows today).
**Database table/columns:** `tips.usd`, filtered by `tips.user_id`.
**Files that calculate it:**
- ✅ `lib/analytics.js:792-793` (the shared/canonical version, returned as `analytics.totalUSD`)
- ✅ `app/dashboard/DashboardPreview.js:360` — re-adds up `tips` itself instead of using `analytics.totalUSD`
- ✅ `app/dashboard/page.js:93-106` (`buildImportPreview`) — re-adds up rows itself, for the import-preview screen
- ✅ `app/dashboard/MoneyMap.js:66` — re-adds up per-session totals itself
- ✅ `app/dashboard/StreamPlanner.js:66` — same, re-adds up itself
- ✅ `app/dashboard/AnalyticsCharts.js:198,254` — re-adds up per weekday/platform itself
**Files that display it:** `app/dashboard/page.js:2112, 2975` (correctly reads the shared `analytics.totalUSD`); the components above show their own locally-recomputed versions in other places on the same dashboard.
**Filters/exclusions:** None — every tip row counts, regardless of type (regular tip, private show, spy show, etc.) or session validity.
**Token-to-dollar conversion:** Not needed here directly — `usd` is already stored as dollars on each row (tokens are converted to `usd` once, at import time — see the CSV Import Totals section).
**Timezone behavior:** Not timezone-sensitive (a plain sum has no "day" boundary to cross).
**Duplicate handling:** Relies entirely on the database's `insert_tips_dedup` de-dup rule at import time (see Database Map) — if a duplicate slips past that rule, it is double-counted here with no second safety net.
**Missing-data behavior:** A tip with no `usd` value (`t.usd` is null/undefined) is treated as `0` and simply doesn't add anything — it does not cause an error or a "some data missing" warning to the user.
**Repeated in multiple places?** ✅ **Yes — confirmed, at least 5 separate reimplementations** (listed above). The math itself (simple addition) is unlikely to disagree in practice, but this is still a direct violation of your own "one implementation" rule, and any future change to what counts as a valid tip would need to be made in 5+ places to stay consistent.
**Different pages, different formulas?** Not numerically different today (all are "sum of usd"), but structurally yes — 5 independent codepaths compute the same thing.
**Existing automated tests:** ❌ None.
**Missing tests:** A test that feeds a known list of tips into `lib/analytics.js` and checks `totalUSD` matches a hand-calculated answer.
**Risk level:** 🟢 Low (the formula itself is trivial and unlikely to be wrong), but 🟠 Medium for long-term maintainability (5 copies to keep in sync).
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 2. Total Tokens

**Plain English:** The sum of every token amount recorded across all a user's tips (tokens are the platform's internal currency before conversion to dollars).

**Formula:** `totalTokens = sum of every tip's "tokens" value` — ✅ `lib/analytics.js:792-793`.
**Numerical example:** Tips of 100, 250, and 60 tokens → Total Tokens = 410.
**Original data source / DB columns:** `tips.tokens`.
**Files that calculate it:** Canonical in `lib/analytics.js:1058`; reimplemented in `DashboardPreview.js:361` and `MoneyMap.js:720` and per-session in `MoneyMap.js:67`/`StreamPlanner.js:67`.
**Filters/exclusions:** None.
**Token-to-dollar conversion:** N/A (this metric stays in tokens).
**Duplicate/missing-data behavior:** Same as Total Earnings above.
**Repeated in multiple places?** ✅ Yes, confirmed (3+ reimplementations).
**Risk level:** 🟢 Low.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 3. Average Earnings Per Hour ("Estimated $/Hour")

**Plain English:** How much money a user earns, on average, per hour they actually stream — used to answer "is streaming worth my time."

**Your written rule:** *"Hourly Rate = totalUSD / (durationMinutes / 60)"*, applied only to sessions that pass the "Valid Session Rule" (`durationMinutes >= 30 AND tipCount >= 2`), used consistently "everywhere — dashboards, best-time, hourly rate, fan insights."

**Actual formula (canonical, `lib/analytics.js:899-916`):**
```
A session counts toward this number only if:
  - it has 2 or more tips, AND
  - its duration is known (not zero-length), AND
  - it lasted at least 15 minutes, AND
  - it earned more than $0

Estimated $/Hour = (sum of USD from all qualifying sessions) ÷ (sum of minutes from all qualifying sessions ÷ 60)
```
🔴 **Confirmed discrepancy:** the real minimum session length used here is **15 minutes**, not the 30 minutes written in your rules.

**Numerical example:** Two qualifying sessions: Session A earned $30 in 60 minutes; Session B earned $10 in 20 minutes. Combined: $40 earned over 80 minutes (1.33 hours) → **$30.00/hour**. (Note this is a *weighted* average across sessions, not an average of each session's own rate — confirmed correct in the code's own comment, and this weighting is done correctly.)

**Original data source:** `tips` table, grouped into inferred "sessions" (see Session Duration below).
**Database table/columns:** `tips.usd`, `tips.date_time` (used to infer session boundaries — there is no dedicated "session length" stored anywhere; it's always guessed from tip timestamps).
**Files that calculate it:** ✅ Canonical `lib/analytics.js:899-916`. Correctly *displayed* (not recalculated) at `app/dashboard/page.js:2125` and `DashboardPreview.js:613`.
**Reimplementations found (🔴 different formulas, different answers possible):**
- ✅ `MoneyMap.js:112-118` — computes `usd ÷ activeDays`, a different ratio entirely (per active day, not per hour)
- ✅ `StreamPlanner.js:98` — `usd ÷ hours` using its **own** 4-hour session grouping (see Session Duration) with **no** 2-tip/15-minute floor at all
- ✅ `AnalyticsCharts.js:242-273` ("Rev Per Hour" chart) — `earnings ÷ inferred hours`, again using a separate 4-hour session inference with no validity floor
**Filters/exclusions:** See eligibility rule above — sessions under 15 minutes, with under 2 tips, with $0 earned, or with an un-determinable duration are silently excluded from this specific number (though they still count toward Total Earnings).
**Token-to-dollar conversion:** N/A directly (uses each tip's already-converted `usd`).
**Timezone behavior:** Not timezone-sensitive (durations are elapsed time, not tied to a calendar day).
**Duplicate handling:** Same database-level protection as Total Earnings; no extra check here.
**Missing-data behavior:** If a session's start/end can't be determined (all tips at the identical timestamp), it's marked "duration unknown" and excluded — the user is shown a count of how many sessions were excluded this way (`excludedUntimedSessionCount`), which is good, honest behavior.
**Repeated in multiple places?** ✅ **Yes, confirmed — at least 3 different formulas**, none of which agree with each other or with the canonical version's 15-minute floor.
**Different pages, different formulas?** ✅ **Yes, confirmed.** A user could see one "$/hour" number on the main dashboard and a meaningfully different one on the Money Map or Stream Planner tab for the identical underlying data.
**Existing automated tests:** 🏷️ Close, but not quite — there's a standalone script at `scripts/verify-estimated-hourly-rate.mjs` that manually re-implements this exact formula and checks it against some test cases. It's a good-faith effort, but it is **not wired into your build or CI process** — nobody runs it automatically, and its own file comment says the project "has no test framework configured." So this is a hand-run script, not a real automated test. ❌ Not truly "confirmed by automated tests."
**Missing tests:** A real test (using a real test framework) confirming the 15-vs-30-minute question is intentional, and one confirming Money Map / Stream Planner match the main dashboard.
**Risk level:** 🔴 High — this is a headline number users make real decisions from ("should I keep streaming"), and it can visibly disagree between tabs.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 4. Session Duration & Total Sessions

**Plain English:** Your raw data is just a list of individual tips with timestamps — there's no "I started streaming, I stopped streaming" button being pressed for CSV imports, so the software has to **guess** where one streaming session ends and the next begins, purely by looking at gaps in time between tips.

**Your written rule:** *"Sessions may split after 60 minutes of inactivity or a platform change."* Separately: *"Valid Session Rule (must be used everywhere): durationMinutes >= 30 AND tipCount >= 2."*

**Actual formula (canonical session-grouping, `lib/analytics/sessions.js:15-40`):**
```
Start a new session when either:
  - the tip is on a different platform than the last one, OR
  - more than 3 HOURS have passed since the last tip

(NOT 60 minutes, as your rules say)
```
🔴 **Confirmed discrepancy #1:** the real gap used is **3 hours**, not 60 minutes.

Even more importantly: 🔴 **The 30-minute / 2-tip "Valid Session Rule" does not exist anywhere in the codebase.** I searched specifically for it. What exists instead is a *different* filter inside `lib/analytics.js:734-740`:
```
A session is "invalid" (thrown out entirely) only if it's under 2 minutes AND earned $0.
A session is "low signal" if it's under 15 minutes AND earned under $10.
Everything else counts as a normal, "meaningful" session.
```
This is a materially looser rule than your written 30-minute/2-tip standard — meaning many sessions your rules say should be excluded from calculations are currently included.

And on top of *that*, the Estimated $/Hour calculation (metric #3) uses **yet a third, different** validity rule (15 minutes + 2 tips + must have earned something).

**Numerical example:** A user tips-in at 10:00pm and 10:45pm on Chaturbate, then again at 1:15am (2.5 hours later) still on Chaturbate. Under your written 60-minute rule, this would be **two sessions** (a gap of 45 min keeps them together for the first pair — wait, 45 min < 60 min so still one session — then the 2.5hr gap to the third tip should split). Under the actual 3-hour code, all three tips stay in **one single session** spanning 3 hours 15 minutes, because the gap (2.5 hours) never exceeds the 3-hour threshold. This directly changes downstream numbers like session duration, $/hour, and "total sessions."

**Original data source:** `tips.date_time`, `tips.platform`, grouped in memory — there is no "sessions" table for CSV-derived sessions; they are recalculated fresh every time.
**Files that calculate session grouping:**
- ✅ Canonical: `lib/analytics/sessions.js:15-40` (3-hour gap + platform change) — its own file header explicitly says: *"Shared by lib/analytics.js ... and app/live/page.js ... never duplicate this grouping logic elsewhere."*
- 🔴 **Duplicated anyway**, with a *different* number, in 3 more places:
  - ✅ `app/dashboard/MoneyMap.js:62-100` — 4-hour gap
  - ✅ `app/dashboard/StreamPlanner.js:48-79` — 4-hour gap, plus floors any session at a minimum 30-minute duration even if the real gap between tips was tiny
  - ✅ `app/dashboard/AnalyticsCharts.js:166-184` — 4-hour gap again
  - ✅ `app/dashboard/page.js:2471` — yet another standalone copy of the exact 3-hour constant, used for a "which fans do I usually see together" feature
**Files that display "Total Sessions":** `DashboardPreview.js:371` reads the canonical `analytics.meaningfulSessionCount`.
**Filters/exclusions:** See the three competing validity rules described above.
**Timezone behavior:** Session grouping itself uses raw elapsed time (timezone-independent), but *reporting* which day/hour a session falls into for other metrics does use the user's local timezone (see Best Day/Best Hour below).
**Duplicate handling:** N/A (sessions are inferred groupings, not stored/deduplicated rows).
**Missing-data behavior:** If a session's tips all share the identical timestamp, its duration is flagged "unknown" rather than treated as 0 minutes — a genuinely careful design choice in the canonical version. The `MoneyMap.js` version instead silently defaults an unknown duration to "5 minutes" (`durationMins: ... || 5`), and `StreamPlanner.js` floors it to 30 minutes — both hide the "we don't actually know" state from the user, unlike the canonical version.
**Repeated in multiple places?** ✅ **Yes, confirmed — 4 separate session-grouping implementations**, with 2 different gap thresholds (3 hours vs. 4 hours) and 3 different "is this session valid" rules.
**Different pages, different formulas?** ✅ **Yes, confirmed.**
**Existing automated tests:** ❌ None.
**Risk level:** 🔴 High — session grouping is the foundation that Estimated $/Hour, Platform Earnings, Best Day, and Best Hour are all built on top of, so this one discrepancy ripples into several other numbers.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 5. Platform Earnings Breakdown

**Plain English:** How much a user earned on each individual platform (Chaturbate vs. BongaCams vs. MyFreeCams, etc.), including a per-platform $/hour figure.

**Formula (canonical, `lib/analytics.js:795-810`):** Built on top of the same session grouping described above — for each platform, adds up USD, tokens, session count, and hours across that platform's sessions, then divides to get `usdPerHour`.
**Files that calculate it:** ✅ Canonical `lib/analytics.js:795-810`. Reimplemented separately in ✅ `MoneyMap.js:102-119`, ✅ `StreamPlanner.js:82-107`, and (without any hours-normalization at all — a raw per-weekday sum) ✅ `AnalyticsCharts.js:189-216`.
**Filters/exclusions:** Inherits whatever session-validity rule that particular file happens to use (see #4 — these three files use their own 4-hour grouping, not the canonical 3-hour one).
**Repeated in multiple places?** ✅ Yes, confirmed — 3 separate reimplementations, each with different underlying session math.
**Different pages, different formulas?** ✅ Yes, confirmed.
**Risk level:** 🟠 Medium-High — a real, visible number that can differ by page.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 6. Best Day

**Plain English:** Which day of the week has historically earned the user the most money, used to tell them "you should prioritize streaming on Fridays," for example.

**Your written rule:** Compare using the **median** (the "typical" value, not skewed by one huge outlier day), not the mean/average, and require enough data (a minimum number of active days) before declaring a "best" day.

**Formula (canonical, `lib/analytics.js:753-782`):**
```
For each day of the week (Sunday, Monday, ...):
  - Only consider it if the user has actually streamed on that weekday at least 3 different times
  - Take the MEDIAN of that weekday's daily earnings (not the average)
  - Whichever weekday has the highest median wins "Best Day"
```
✅ This correctly matches your written rule — median, minimum 3 data points.

**Numerical example:** A user's Friday earnings across 4 different Fridays: $20, $22, $19, $95 (one huge outlier night). The median is $21 (the middle-ish typical value), not the $39 average that one big night would otherwise pull it toward — so an unusually lucky one-off night doesn't falsely declare Friday the "best day" if it's not usually that good.

**Files that calculate it:** ✅ Canonical `lib/analytics.js:753-782`, correctly displayed via `analytics.bestDay` at `app/dashboard/page.js:2146, 2455-2456, 7000-7006`.
🔴 **Reimplementation with a real discrepancy:** ✅ `AnalyticsCharts.js:189-216` ("Earnings by Day" chart) — this instead shows the **raw total sum** of USD per weekday per platform, with **no minimum-data requirement at all**. Since this chart is the one most visually likely to be read by a user as "which day is my best day," and it ranks by raw total rather than a fair per-day average, it can visually suggest a different "best day" than the number shown elsewhere on the same dashboard — and it directly contradicts your own rule "Never rank by total earnings alone."
**Filters/exclusions:** Requires ≥3 active days per weekday (canonical version only).
**Timezone behavior:** ✅ Uses the visitor's local timezone correctly (`toLocalDow()`, `lib/analytics.js:38-48`, via `Intl.DateTimeFormat`) — matches your rule "never assume UTC for display."
**Missing-data behavior:** A weekday with fewer than 3 active days is simply left out of the comparison — no "not enough data" label is shown for that specific weekday, though the overall "Best Day" tile does properly show nothing if no weekday qualifies.
**Repeated in multiple places?** ✅ Yes, confirmed — 1 canonical + 1 conflicting chart.
**Different pages, different formulas?** ✅ Yes, confirmed.
**Risk level:** 🟠 Medium.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 7. Best Hour / Peak Hours

**Plain English:** Which hour of the day earns the most, so the user knows when to "go live."

**Your written rule:** *"Use median over mean. Minimum 3 active days required to qualify a peak hour."* Also: *"Best-time calculations should use actual time streamed"* and *"Best Time Score = totalUSD in time bucket / total streamed hours in that time bucket."*

**Formula (canonical, `lib/analytics.js:778-783`):** Same median + minimum-3 logic as Best Day, applied per hour-of-day instead of per weekday. ✅ Matches your median/minimum-3 rule correctly. Also timezone-aware via the same `toLocalHour()` helper. ✅

**But: this canonical "Best Hour" is a *median of hourly totals*, not literally "totalUSD ÷ hours streamed" (the Best Time Score formula from your rules) — it's a closely related but not identical calculation.** 🏷️ I consider this a reasonable interpretation of your rule rather than a violation, since it does normalize for how often that hour recurs, but it's worth knowing it's not the literal division formula written down.

**Reimplementations found (🔴 real discrepancies):**
- ✅ `app/dashboard/page.js:2269-2283` and `2618-2630` — two "which hour is this specific fan usually online" predictors that rank by **raw tip count**, not dollars-per-hour, using a 3–5 tip minimum instead of the "3 active days" rule. (These are arguably a different feature — predicting one fan's presence, not "your best hour to stream" — but they use the word "best hour" internally and could be confused with the main metric.)
- ✅ `app/dashboard/StreamPlanner.js:109-142` — its own "best windows" calculation using the **mean**, not the median (directly contradicting "use median over mean"), with its own confidence-band system instead of the 3-active-day rule.
- ✅ `app/dashboard/MoneyMap.js:121-138` — raw per-2-hour-block totals with no normalization or minimum-sample rule at all.

**Files that calculate it:** ✅ Canonical `lib/analytics.js:778-783`; correctly displayed at `app/dashboard/page.js:834-856`.
**Timezone behavior:** ✅ Confirmed timezone-aware and correct in the canonical version.
**Repeated in multiple places?** ✅ Yes, confirmed — at least 3 divergent implementations beyond the canonical one.
**Different pages, different formulas?** ✅ Yes, confirmed — Stream Planner explicitly uses mean instead of median, a direct rule violation.
**Risk level:** 🟠 Medium-High.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 8. Top Tippers / Top Spender

**Plain English:** Who has given the user the most money — the VIP-fan leaderboard shown in the Whales/CRM tab.

**Your written rule:** These are supposed to be **two different rankings**: "Top Tipper" = highest total from *ordinary tips only* (excluding private shows, group shows, spy shows, and paid-session revenue); "Top Spender" = highest total across *all* revenue types combined.

**Actual formula (`lib/analytics.js:420-430`, `identifyWhales()`):** 🔴 **There is only one ranking.** Every tip type — regular tips, private shows, spy shows, everything — gets summed together into one `totalUSD` per fan, with no separation by type at all. What your product calls "Top Tipper" everywhere in the UI is actually computing "Top Spender" math (all revenue types combined) — the distinction your rules describe simply isn't built.

**A second, different discrepancy:** In the CSV-import-preview screen, ✅ `app/dashboard/page.js:93-106` (`buildImportPreview`) computes its own "topSpender" by ranking fans by **total tokens**, not total dollars:
```
topSpender = whichever fan sent the most TOKENS (not the most dollars)
```
🔴 This directly violates two rules at once: it should rank by USD, and it should prefer trusted USD over raw token counts.

**Numerical example of the problem:** A fan tips 1,000 tokens on BongaCams (worth $25 at BongaCams' lower rate) and another fan tips 600 tokens on Chaturbate (worth $30 at Chaturbate's higher rate). Ranking by raw tokens would call the first fan the "top spender" ($1,000 tokens > 600 tokens) even though the second fan actually paid more real money ($30 > $25). This is exactly the kind of cross-platform token-rate mistake your rules were written to prevent.

**Files that calculate it:** ✅ `lib/analytics.js:420-430` (main whales/top-tippers list, all revenue types merged); ✅ `app/dashboard/page.js:93-106` (import-preview "top spender," ranked by tokens).
**Files that display it:** `app/dashboard/page.js:4780, 2610-2644` (main "Top Tipper" UI), `page.js:6004` (import-preview "Top Spender" card).
**Onboarding preview:** `app/onboarding/page.js` also shows a `topSpender` value (line ~1058) — I could not confirm whether it shares the token-ranking bug above, because that file is explicitly off-limits to read/edit per your own standing instructions (Rule 2), and I respected that boundary. ❓ **Unknown — needs direct testing by you, or a one-time supervised read.**
**Risk level:** 🔴 High — this affects which real fan a user is told to prioritize/thank, with real relationship and revenue consequences if it's wrong.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code (except the onboarding-preview piece, which is ❓ Unknown).

---

## 9. Fan Counts (Unique Tippers)

**Plain English:** How many distinct people have tipped a user, ever.

**Your written rule:** *"Fan Key = platform + ':' + normalizedUsername. Never merge fans across platforms by username alone."* — because the same short username (e.g., "kitty22") could belong to two completely different real people on two different platforms.

🔴 **Confirmed, pervasive violation:** I checked every single place in the codebase that groups tips by fan, and **every one of them uses only the lowercase username, with no platform attached, as the fan's identity.** This is not a one-off bug — it's the fan-identity rule used everywhere:
- `lib/analytics.js:423` (main whale/fan list)
- `lib/analytics.js:945` (returning-vs-new-fan calculation)
- `lib/analytics.js:981, 1001, 1014, 1019` (monthly stats, tip-type breakdown, private/spy fan lists)
- `lib/analytics/sessions.js:30, 35` (which fans were in a given session)
- `DashboardPreview.js:368` (headline "Total Fans" count)
- `MoneyMap.js:143` (not even lowercased, so "Kitty22" and "kitty22" could also be treated as two different fans here — a second, smaller identity bug on top of the platform issue)
- `StreamPlanner.js:181`

**Numerical example of real-world impact:** A user streams on both Chaturbate and BongaCams. A fan named "bigtipper" spends $50 on Chaturbate, and a *completely different, unrelated* person also happens to use the username "bigtipper" on BongaCams and spends $80. Today's code merges these into a single fan record showing "$130 lifetime, 2 platforms" — misrepresenting two strangers as one loyal, multi-platform fan. This affects: fan counts, whale/shark tiers, "who hasn't tipped in a while" alerts, churn-risk warnings, and CRM notes (a note written for one real person could show up attached to a different real person's activity).

**Files that calculate it:** All listed above.
**Files that display it:** `DashboardPreview.js:369` and equivalent fan-count tiles throughout `page.js`.
**Risk level:** 🔴 High — this is a data-correctness issue with real relationship-management consequences, not just a display quirk, and it's the most consistently-applied "wrong" rule I found (i.e., it's wrong everywhere, not just in one place).
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 10. Whale / Shark / Regular / Dormant Classification

**Plain English:** A tier system that labels each fan by how valuable/active they are, so a user knows who to prioritize.

**Your written rule (exact dollar and tip-count thresholds):**
```
Whale   = spent $100+ lifetime AND tipped 10+ times
Shark   = spent $30+ lifetime  AND tipped 5+ times
Regular = spent $5+ lifetime   AND tipped 2+ times
Dormant = hasn't tipped in over 60 days
```

**What's actually implemented — three different, mutually incompatible systems:**

**System A — the main dashboard/CRM (`lib/analytics.js:432-451`), a *relative ranking*, not a dollar threshold:**
```
Rank every fan by lifetime USD, best to worst.
The top 5% of fans (by rank, not dollar amount) = "Whale"
The next 15% (5%–20%) = "Shark"
Everyone else = "Regular"
...unless they haven't tipped in over 60 days (or 3x their usual tipping gap, whichever is longer) = "Dormant"
```
🔴 **This means the dollar amount needed to be a "Whale" changes depending on how many total fans a user has**, which directly contradicts having a fixed, meaningful $100 threshold. A user with only 10 total fans would have a "Whale" as soon as one fan is simply their top spender — even if that fan only ever tipped $8 total. A user with 500 fans might have a genuine $300-lifetime fan land in "Regular" territory percentile-wise even though your rule says $300 clearly qualifies as a Whale.

**System B — the Stream Planner tab (`StreamPlanner.js:177-207`):**
```
Whale = 500+ tokens lifetime (a flat token count — no dollar figure, no tip-count requirement, and no Shark/Regular/Dormant tiers exist at all in this tab)
```

**System C — the Money Map tab (`MoneyMap.js:140-155`):** An independently-written copy of System B's exact same "500+ tokens" rule.

🔴 **The result: the exact same fan can be labeled "Whale" on one tab and not appear as a whale at all on a different tab**, for the identical underlying tip history — because System A uses percentile rank, and Systems B/C use a flat 500-token cutoff that ignores dollar value entirely (500 BongaCams tokens is worth $12.50; 500 Chaturbate tokens is worth $25 — System B/C treat these as equally "whale" despite being different real dollar amounts, which also breaks the token-rate-differs-by-platform rule).

**Numerical example:** A fan spends exactly $100 across 12 tips on Chaturbate (2,000 tokens). Per your written rule, this is unambiguously a Whale. In System A, whether they're labeled "Whale" depends entirely on how many other fans that user has and how they rank relative to them. In Systems B/C, 2,000 tokens comfortably clears the flat 500-token bar regardless of dollar value, so they'd show as a "whale" there too — but a fan who spent $100 in a single $100 BongaCams tip (4,000 tokens at BongaCams' lower rate) would show as an even "bigger" whale by token count in B/C despite earning the user the identical $100.

**Files that calculate it:** ✅ `lib/analytics.js:432-451` (System A), ✅ `StreamPlanner.js:177-207` (System B), ✅ `MoneyMap.js:140-155` (System C).
**Files that display it:** `page.js:4258` and the Whales tab (System A); `StreamPlanner.js:741`-area and `MoneyMap.js:741` (Systems B/C respectively, both labeled "Whales").
**Note:** the exact numbers from your written rule ($50, 10+ fans, etc.) do appear in the code, but only as *feature-unlock gates* ("you need 10+ fans and $50+ earned to unlock the Whales tab" — `DashboardPreview.js:157,172` and `page.js:6064`), not as the actual per-fan tier logic.
**Risk level:** 🔴 High — three incompatible definitions of the same headline concept, shown on different tabs of the same product.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 11. Weekly Leaderboard

**Finding:** ❌ **This feature does not exist in the codebase.** I searched the entire repository for the word "leaderboard" (in any casing) and found zero matches anywhere. There is no weekly-ranking screen, formula, or database structure for it today.
**Risk level:** N/A (nothing to audit) — 🏷️ flagged only because it was on the requested list; if you believe this feature exists and is live, that would mean it lives somewhere I don't have access to, or under a name I didn't think to search for.
**Confirmed / Assumed / Unknown:** ✅ Confirmed absent by direct search.

---

## 12. All-Time Leaderboard

**Finding:** ❌ Same as above — no "leaderboard" feature of any kind exists in the codebase. The closest related things are: (a) the per-fan "Top Tippers" list described in #8, and (b) a sort-by-total-spend option in the admin panel (`app/admin/page.js:172`) that ranks *platform users* (your customers), not fans — a completely different concept, for your eyes only, not shown to end users.
**Risk level:** N/A.
**Confirmed / Assumed / Unknown:** ✅ Confirmed absent by direct search.

---

## 13. Live Mode Totals

**Plain English:** While a user is actively streaming with "Live Mode" turned on (via the browser extension or the Live page), the app shows running totals for the current session — tips received, tokens, dollars, top tipper for tonight, etc.

**Original data source:** The `live_tips` database table — a short-lived staging table, separate from the permanent `tips` history.
**Database table/columns:** `live_tips.tokens`, `live_tips.usd`, `live_tips.username`, tied to a `live_sessions` row via `session_id`.
**How a live tip's dollar value is set:** `app/api/live/tips/route.js:70` correctly imports `tokenRate()` from `lib/constants.js` — ✅ this specific insert path is compliant with the single-source-of-truth rule.
**What happens to a live tip afterward — 🔴 the most important finding in this section:**
- If the user is on the **free plan**, their live tip stays only in `live_tips` and is never copied into the permanent `tips` history table (confirmed via the database trigger `sync_live_tip_to_tips`, see Database Map) — meaning free-plan users effectively lose their live-session history once it rolls off (their real-time totals work, but nothing is kept long-term).
- If the user is on a **paid plan** (`pro`/`unlimited`), the tip gets copied into `tips` **twice, through two independent code paths**, both of which fire on the same event: ✅ `app/api/live/tips/route.js:94-112` inserts directly into `tips` with **no de-dup RPC call at all** (bypassing `insert_tips_dedup` entirely, and not even setting a `usd` value on that insert), **and** the database's own `sync_live_tip_to_tips` trigger *also* fires and inserts (this one does have its own 3-second near-duplicate check). Because production currently has **zero paying users** (confirmed by directly reading the live `subscriptions`/`profiles` data structure — every account is on the free plan today), 🏷️ this double-write has never actually happened to a real user yet — but it is live, deployed code that will run the moment your first Pro user goes live-streaming.
- 🔴 **A related bug, not yet fixed everywhere:** the database trigger's fallback math for a live tip with no `usd` value hardcodes a flat `tokens × 0.05` regardless of platform — meaning a BongaCams live tip that's missing its `usd` value would be priced at Chaturbate's rate (0.05) instead of BongaCams' correct rate (0.025), doubling its counted value. A sibling bug in the CSV-import RPC (`insert_tips_dedup`) was found and explicitly fixed for this exact issue in a recent migration (`20260710_fix_insert_tips_dedup_token_rate.sql`) — but that fix was **not** applied to this live-tip trigger, based on my direct read of the trigger's current live code.
**Chrome extension double-counting:** Your rules state the extension should skip its own chat-reading tip detection when a user has connected Chaturbate's official "Stats API" (to avoid counting the same tip twice from two different sources). 🔴 **I searched the entire extension's code and found no such check exists.** The extension's chat-watcher runs unconditionally. Combined with the fact that the server also has two *other*, completely independent ways of pulling in Chaturbate tips (an "Events API" poller and a "Stats API sync"), a user who has more than one of these connected at once has a real risk of the same tip being counted multiple times.
**Files that calculate/display Live totals:** `app/api/live/tips/route.js`, `app/live/page.js`, `app/live/EventsSync.js`, `chrome-extension/background.js`, `chrome-extension/content.js`.
**Timezone behavior:** Live totals are inherently "right now," so timezone display matters less here than elsewhere, but was not specifically re-verified for this section.
**Risk level:** 🔴 High — real financial double-counting risk (extension + multiple Chaturbate ingestion paths) and a real duplicate-insert code path waiting to trigger for your first paying customer.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code and the live database's trigger definitions.

---

## 14. CSV Import Totals

**Plain English:** When a user uploads a CSV file or pastes their tip history, the app shows a summary before and after import — "we found 340 tips worth $890."

**Files involved:**
- ✅ `app/api/upload/route.js` — the real server-side import endpoint. Uses `parseCSV`/`detectPlatform` from `lib/analytics.js` (the intended single source of truth for parsing), inserts through the `insert_tips_dedup` database function correctly (✅ compliant with the dedup rule), and logs a summary row into the `csv_uploads` table.
- 🔴 `app/onboarding/page.js` — the *actual* onboarding paste flow does **not** send raw pasted text to the server the way your rules describe ("Raw paste text is sent directly to `/api/upload` as plain text... platform detection is server-side only"). Instead, it parses the pasted text **client-side**, using its own separate hand-written parser (functions named `tryParseDate`, `parseRows`, `buildPreview` inside that file), builds its own CSV file *from the already-parsed data*, and only then uploads that reconstructed file — with the platform explicitly pre-set by the user's onboarding selection, which causes the server's own `detectPlatform()` to be skipped entirely. The file's own code comment explains this was a deliberate choice ("the server has its own independent parser, and re-parsing the raw text there can disagree with what this page's parseRows() already validated") — 🏷️ a reasonable engineering tradeoff, but it does directly contradict three specific, separate sentences in your written rules about how this flow is supposed to work.
**Token conversion in this client-side parser:** ✅ Correctly imports rates from `lib/constants.js` — not a hardcoded-rate problem, just a "where does parsing happen" discrepancy.
**A second, independent hand-written parser** also exists for BongaCams paid-session CSVs (`app/api/upload-paid-sessions/route.js`), outside of `lib/analytics.js` — a third parsing implementation.
**Filters/exclusions during import:** Rows missing a date, a username, or with zero tokens/USD are dropped silently before insert (both server-side `/api/upload` and the client-side onboarding parser apply similar — but independently coded — filtering logic).
**Duplicate handling:** Goes through `insert_tips_dedup`, which silently skips anything matching an existing row's `(user, fan, tokens, dollars-rounded, timestamp, sequence-number)` combination — the user is told how many rows were "skipped" vs. "inserted," which is good, transparent behavior.
**Missing-data behavior:** A completely unparseable file returns a clear "No valid rows found" error rather than silently importing nothing — good.
**File-size/row limits:** 🔴 `app/api/upload/route.js` has **no file-size limit and no row-count cap** of its own. (The separate Chrome-extension "scan token history" import route, `app/api/scan/preview/route.js`, does cap at 5,000 rows and validates the platform against an allowlist — that route is more defensively written than the main CSV upload route.)
**Risk level:** 🟠 Medium — the numbers themselves are likely accurate for a given import, but there are now three independently-coded parsers (server CSV, client-side paste, paid-sessions CSV) that could drift out of sync over time, plus a missing size/row cap on the most commonly used upload path.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## 15. Onboarding Preview Metrics

**Plain English:** Before a brand-new user fully commits to importing their data, onboarding shows them a quick preview ("we found 340 tips, here's your top spender, here's your total").

**What I could verify:** The client-side parsing that builds this preview lives in `app/onboarding/page.js`, which — per your own Rule 2 — I did not open in full or edit; I only confirmed its existence and general shape through targeted, minimal searches, out of respect for that protection.
**What I can say with confidence:** A near-identical "import preview" calculation also exists in `app/dashboard/page.js:93-106` (`buildImportPreview`, used for *re*-imports from an already-onboarded dashboard), and that version does have the confirmed "topSpender ranked by tokens instead of dollars" bug described in metric #8. ❓ **Unknown whether the onboarding version shares this same bug** — they are very likely related/copied code given the similar function purpose, but I have not confirmed this directly, and would need your explicit permission to open that protected file to check.
**Risk level:** 🟠 Medium (based on the likely-related dashboard bug) — ❓ genuinely unknown until verified.
**Confirmed / Assumed / Unknown:** ❓ Unknown / Assumption only.

---

## 16. Dashboard Metrics — the "Dashboard Stage" system

**Plain English:** Your product is supposed to show a new user a simpler, "starter" version of the dashboard when they don't have much data yet, and gradually unlock the full experience as they import more history — this is decided by a "what stage is this user at" calculation.

**Your written rule (exact thresholds):**
```
If live right now → "live-active"
Else if 0 tips → "no-data"
Else if 250+ tips AND 10+ valid sessions AND $100+ earned → "full-dashboard"
Else if 100+ tips AND 5+ valid sessions AND $50+ earned  → "growing-insights"
Else if 25+ tips  AND 2+ valid sessions AND $10+ earned  → "first-valid-data"
Else → "tiny-import"
```

**What's actually implemented — three different systems again:**

1. **Your exact rule *is* implemented — correctly, almost verbatim — but only inside two admin-only files** (`app/api/admin-stats/route.js:10-17` and `app/api/admin/stats/route.js:24-31`, byte-for-byte identical copies of each other). These power *your* admin panel, not what real users see, and even here the "valid sessions" part of the rule is missing — both versions check tip count and dollar total only.
2. **A dead stub sitting in the shared component file** (`DashboardPreview.js:117-119`) — a function with the exact name `getDashboardStage()` that your rule describes, but its entire body simply `return 'ready'` no matter what data is passed in. It does nothing.
3. **🔴 The system real users actually see** is a completely different, unrelated function called `getDashboardReadiness()` (`DashboardPreview.js:107-114`), imported directly by `app/dashboard/page.js:15`. It uses different stage names entirely (`setup / building / starter / warming / ready` instead of `no-data / tiny-import / first-valid-data / growing-insights / full-dashboard / live-active`) and different numeric thresholds (25/50/100 tips and $10/$25/$50, instead of your written 25/100/250 tips and $10/$50/$100).

**What this means in practice:** The dashboard-stage logic you wrote down and expect the product to follow is not the logic actually running for your users today. A real user's experience is governed by a second, separately-invented system with different names and different thresholds that nobody documented.

**Files:** See above.
**Risk level:** 🟠 Medium — this doesn't corrupt financial numbers, but it does mean the "what should this user see right now" logic doesn't match your own specification at all, which matters for anyone (including a future AI assistant) trying to reason about or modify onboarding/dashboard behavior based on your written rules.
**Confirmed / Assumed / Unknown:** ✅ Confirmed by reading the code.

---

## Summary table

| # | Metric | Formula repeated? | Pages disagree? | Matches your written rule? | Risk |
|---|---|---|---|---|---|
| 1 | Total Earnings | ✅ Yes (5+ places) | Unlikely in practice | ✅ Yes (math is trivial) | 🟢 |
| 2 | Total Tokens | ✅ Yes (3+ places) | Unlikely in practice | ✅ Yes | 🟢 |
| 3 | Avg $/Hour | ✅ Yes (3+ places) | ✅ Yes | 🔴 No (15 min, not 30) | 🔴 |
| 4 | Session Duration/Count | ✅ Yes (4 places) | ✅ Yes | 🔴 No (3–4 hr gap, not 60 min; no 30-min/2-tip rule anywhere) | 🔴 |
| 5 | Platform Earnings | ✅ Yes (3 places) | ✅ Yes | 🏷️ Partial | 🟠 |
| 6 | Best Day | ✅ Yes (1 conflicting chart) | ✅ Yes | ✅ Yes (canonical) / 🔴 No (chart) | 🟠 |
| 7 | Best Hour | ✅ Yes (3+ places) | ✅ Yes | ✅ Yes (canonical) / 🔴 No (Stream Planner uses mean) | 🟠 |
| 8 | Top Tipper/Spender | ✅ Yes | ✅ Yes | 🔴 No (no type split; one ranks by tokens) | 🔴 |
| 9 | Fan Counts / Fan Key | ✅ Yes (everywhere) | Consistently wrong everywhere | 🔴 No (never uses platform+username) | 🔴 |
| 10 | Whale/Shark/Regular/Dormant | ✅ Yes (3 systems) | ✅ Yes | 🔴 No (percentile vs. flat token vs. your $ thresholds — none match) | 🔴 |
| 11 | Weekly Leaderboard | N/A — doesn't exist | N/A | N/A | — |
| 12 | All-Time Leaderboard | N/A — doesn't exist | N/A | N/A | — |
| 13 | Live Mode Totals | ✅ Yes (double-write risk) | 🏷️ Not yet (no paid users) | 🔴 No (dedup + extension double-count rules not followed) | 🔴 |
| 14 | CSV Import Totals | ✅ Yes (3 parsers) | 🏷️ Likely not numerically, structurally yes | 🔴 No (paste flow doesn't match written description) | 🟠 |
| 15 | Onboarding Preview | ❓ Unknown | ❓ Unknown | ❓ Unknown | 🟠 |
| 16 | Dashboard Stage | ✅ Yes (3 systems) | ✅ Yes | 🔴 No (real users see a different, undocumented system) | 🟠 |

**No automated tests exist for any metric in this table.** The only exception is one manually-run verification script (`scripts/verify-estimated-hourly-rate.mjs`) for metric #3, which is not part of your build process and does not run automatically.
