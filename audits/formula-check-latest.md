# Formula Integrity Check

- **Run timestamp (UTC):** 2026-07-13T16:03:58Z
- **Window checked:** since 2026-07-13T04:03:58Z (~12 hours) — no prior checkpoint file found, so this run establishes the baseline
- **Commits reviewed:** 1
- **Result:** CLEAN — no new formula duplication, no new token-to-USD math outside `lib/constants.js`, no new $/hr or session/dedup logic, no protected-file edits.

## Commits in window

| Commit | Date (UTC) | Message |
|---|---|---|
| `e014220` | 2026-07-13 13:19:51 | Fix ReferenceError crash in loadData after CSV upload (#257) |

## Detail

`e014220` — `glowmetrics_fresh/app/dashboard/page.js`: moved an existing `const userTz = ...` declaration up a few lines within the same `loadData()` function so it's in scope for both the `runEngine()` call and the later `get_user_insights` RPC call. No new calculation, no formula change, no new token/USD/dedup/session logic — pure scope fix for a pre-existing `ReferenceError`. Does not touch `lib/constants.js`, `lib/analytics.js`, or `app/onboarding/page.js` (protected file untouched).

No violations found against any of the 6 checks (token math, $/hr & session/hours calc, dedup logic, best/peak calc, revenue classification, protected-file direct edits).
