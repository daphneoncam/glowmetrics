# CamCash Free / Pro Entitlement Contract

This document governs how plan access must be implemented and tested.

## Core rule

There must be one source of truth for plan entitlements.

Do not create contradictory page-level plan logic.

Presentation and enforcement must agree.

## Free plan

Current approved product direction:

- 1 platform with unlimited history
- secondary platforms use a 31-day rolling window each
- Top 3 fans visible
- deeper fan rows/details gated according to canonical entitlement logic
- Live Mode core available within current Free limits
- Sessions available according to current product entitlement
- limited insight depth where the canonical product rules specify
- one blurred/teased VIP discovery where implemented
- platform badge remains visible
- secondary platforms may have limited import/history behavior according to canonical rules

If implementation has since changed, the codebase’s canonical entitlement source is authoritative; report contradictions before modifying behavior.

## Pro plan

Current approved product direction includes:

- multi-platform unlimited history
- full fan profiles
- Stream Planner
- Money Map
- advanced Live Mode recap
- full history
- platform comparison
- deeper fan CRM
- full paid/private session detail

If implementation has since changed, report the discrepancy rather than silently overwriting the product contract.

## No Free / Pro leakage

Do not expose Pro-only data through:
- UI
- hidden state
- APIs
- selectors
- direct routes
- query parameters
- caches
- tooltips
- modals
- drawers
- charts
- exports
- aggregates

A Free aggregate must be computed from the exact Free-entitled dataset.

Do not compute from full history and merely hide the underlying rows.

## No contradictory gating

If one page says a feature is Free and another canonical source says Pro, STOP and report:

- Feature
- Existing entitlement source
- Conflicting behavior
- Affected pages
- Recommended resolution

## Free + low data

A Free low-data account must:
- receive only Free-entitled data
- receive useful descriptive metrics from available data
- not receive Pro history to “fill in” sparse analytics
- not confuse “not enough data” with “upgrade required”
- not show fake zeroes for unavailable metrics

## Free + high data

A Free high-data account may have more stored data than it is entitled to view.

All Free analytics must be computed only from Free-entitled history/platforms.

This includes:
- typical session
- median
- trends
- best time
- best platform
- fan contribution
- top fan dependency
- plan-window comparison
- session buckets
- performance classification
- charts
- summaries

## Pro + low data

Pro unlocks feature access, not statistical validity.

A Pro low-data account may still need:
- “Not enough sessions yet”
- “No reliable baseline yet”
- “More data needed for comparison”

Do not fabricate richer insight just because the user pays for Pro.

## Pro + high data

Pro high-data accounts should receive full entitled depth while remaining performant.

Verify:
- full entitled history
- all entitled platforms
- full fan detail
- advanced insights only where supported
- efficient selectors
- lazy/memoized heavy detail
- navigable large histories

## Required 4-state matrix

Every changed analytics/dashboard feature must be tested in:

1. Free + low data
2. Free + high data
3. Pro + low data
4. Pro + high data

For each state verify:

### Data scope
- correct history window
- correct platforms
- correct fan depth
- correct session depth

### Insight behavior
- no invented analytics
- minimum-sample guards
- correct fallback copy
- no fake zeroes

### Entitlement
- no Pro leakage to Free
- no accidental Free restrictions on Pro
- no contradictory lock states

### Performance
- acceptable rendering
- no repeated full-history work

### UI
- low-data state remains useful
- high-data state remains readable
- no overflow from large values/usernames
- no duplicate upgrade prompts

## Enforcement audit

For each changed feature report:

Feature:
Free behavior:
Pro behavior:
UI enforcement:
Data enforcement:
History window:
Platform scope:
Fan-detail scope:
Direct-access behavior:
Tests covering it:
