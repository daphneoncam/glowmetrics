# Stream Planner — Entitlement Spec (design document, not implemented)

## What Stream Planner keeps (its genuine, non-duplicate value)

Day-off preferences, time-block preferences, max-hours/day, the five plan modes (Growth
Mode, Whale Watch, Testing Mode, Low Burnout, Emergency Goal), weekly income goal, the
stop-rule and suggested-first-goal logic, and the weekly schedule *rendering*. None of this
duplicates anything found elsewhere in the app — this is the real "turn recommendations into
an actual schedule" tool, confirmed in the investigative pass.

## What Stream Planner gives up (calculation ownership, not UI)

`groupIntoSessions()`, `platformEfficiency()`, and `bestWindows()` stop being independent
calculations. Once the canonical best-time service exists at day×hour granularity (the
largest scope item in `canonical-insight-architecture.md`), Stream Planner's "This Week's
Plan" table sources its per-slot data (`avgUsdPerHr`, `topPlatform`, `confidence`,
`sessionCount`) from that service, filtered/sorted by the user's own preferences
(days/blocks/mode) — the preference logic stays exactly as it is; only the underlying
per-slot numbers change source.

**Open question, not resolved here:** the session-detection rule conflict
(`analytics-duplication-map.md` §1) means Stream Planner's numbers will very likely *change*
once it stops using its own 4-hour/platform-agnostic grouping — this needs the product
decision on canonical session rules made first, since it directly changes what "This Week's
Plan" shows for real users with real streaming patterns that span platform switches.

## Free/Pro disposition

| Element | Current gate | Disposition |
|---|---|---|
| "Tonight's Brief" (today's window, $/hr, suggested goal, stop-rule, whale-watch) | Free | **FREE** — no change; this is Stream Planner's version of the Daily Brief "today" signal and should stay free by the same logic Daily Brief's real-time nudge stays free |
| Today's row in the week table | Free | **FREE** — no change |
| **The other 6 days of the week table** | **CSS `blur(3px)`, real $/hr/platform/window data present in the DOM** — confirmed the second instance of this exact weak-gate pattern, alongside Creator Report | **PRO, server-redacted** — the API response for a free user should return today's slot in full and the other six as a locked/count-only placeholder, not the full week with six entries visually blurred |
| "Untested Opportunities" / "Opportunity Grid" | Already properly locked (no data sent) | **PRO** — no change, already correct, the one part of this component already matching the target contract |

## Boundary with Daily Brief, stated precisely (per the direction given)

**Daily Brief = interpretation/recommendation for today**, sourced from the canonical
best-time service, presented as "here's what your data says, here's what to do about it
right now." **Stream Planner = the scheduling tool that turns the same canonical data into a
week**, filtered through the user's own availability/preferences. Today, both independently
answer "what's my best window today" — after this migration, only one calculation answers
that question, and both surfaces read from it, potentially disagreeing only in how the
information is presented (a recommendation vs. a grid), never in the underlying number.

---
No code changed. No UI changed. Spec only.
