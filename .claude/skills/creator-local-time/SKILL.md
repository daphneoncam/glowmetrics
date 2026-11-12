---
name: creator-local-time
description: Use for any CamCash task involving timestamps, imports, sessions, earnings dates, best times, fan activity, private shows, or timezone conversion.
---

# Creator-Local Time Skill

Use this skill whenever modifying code that parses, stores, groups, displays, or analyzes dates/times in CamCash.

## Prime directive

A timestamp with no timezone is NOT UTC.

Imported platform timestamps without `Z` or an explicit offset must be interpreted as wall-clock time in the creator's selected IANA timezone.

## Required algorithm

For source text like:

`Oct 9, 2026, 5:33 AM`

and creator timezone:

`America/Los_Angeles`

do:

1. Parse the date/time fields without assigning UTC.
2. Resolve those fields in `America/Los_Angeles`.
3. Use that localized value for creator-calendar logic.
4. Convert to UTC only if an absolute instant is needed for persistence.
5. Convert back to creator-local time before deriving date/day/hour buckets.

## Forbidden patterns

Do not use patterns that cause naive strings to be treated as UTC, including conceptually:

```js
new Date(naiveTimestamp)
new Date(naiveTimestamp + "Z")
Date.parse(naiveTimestamp)
```

unless the input is explicitly documented as an absolute/UTC timestamp.

Do not use UTC-based:
- day boundaries
- date-range endpoints
- best-hour buckets
- session calendar dates
- fan activity dates
- private-show dates

for creator-facing analytics.

## Canonical checks

For `America/Los_Angeles`:

`Oct 9, 2026, 5:33 AM`
=> local calendar date MUST be `2026-10-09`.

A parser that produces `2026-10-08` has a timezone bug.

## Data-source classification

Before parsing a timestamp, classify it:

- `explicit_absolute`: source contains `Z` or numeric offset
- `creator_local_naive`: source contains date/time but no timezone
- `date_only`: source contains a calendar date only

Handle each deliberately. Never let the JS runtime guess.

## Regression tests

Any change touching timestamp logic must test:

- early-morning local time
- near-midnight local time
- DST transition when relevant
- earliest/latest imported date
- creator-local day/hour aggregation

Include at least one test where incorrect UTC interpretation would move the event to another calendar day.

## Completion checklist

Before reporting a time-related task complete:

- Confirm source timezone semantics.
- Confirm creator IANA timezone is explicit.
- Confirm naive input never defaults to UTC.
- Confirm local date boundaries are correct.
- Run timezone regression tests.
- State whether UTC is used only after localization for storage/transport.
