# CamCash Canonical Analytics Rules

This document records the analytics rules Codex must preserve unless an explicitly approved change updates this file and the canonical implementation together.

## Core session rules

- Session boundary: 60 minutes of inactivity OR platform change.
- A platform change creates a new analytical session.
- Use the existing canonical meaningful-session implementation already in the repo.
- Do not create page-specific sessionization rules.
- Unknown duration does not contribute to hourly-rate calculations.
- Earnings from unknown-duration records may still count toward totals where canonically allowed.

## Best-time rules

- Use creator-local timezone.
- Use the existing canonical best-time implementation.
- Do not introduce another page-specific best-time calculation.
- Where the existing three-day rule applies, require at least 3 distinct creator-local calendar dates.

## Fan identity

Canonical fan identity:
`platform:username`

Do not merge fan identities across platforms unless a future explicitly approved identity-linking system is introduced.

## Fan tiers — unresolved product decision

Fan-tier semantics and classification thresholds are not finalized. Neither the historical Claude instruction thresholds nor the bundle's prior tier thresholds are approved as the new canonical contract.

Preserve the current implementation until a separate product decision and implementation change are explicitly approved. This documentation update does not change runtime behavior.

### Product direction pending validation

- Regular describes consistency: repeated tipping across sessions or a recurring time pattern. Two tips alone do not establish a Regular.
- Whale describes materially large spend relative to the creator's fan base, through one unusually large contribution or repeated large contributions. Tip count alone does not establish a Whale.
- Shark describes meaningful repeat spending below Whale level; its exact definition remains unresolved.
- New Spender describes a first-time spender.
- Dormant describes previously active fans who are now inactive; inactivity rules remain subject to the canonical behavioral implementation.

Spend magnitude and repeat behavior should be considered separately. A future model may support Whale + Regular or Whale + New; these combinations are product direction, not implemented classifications.

Do not introduce fixed spend amounts, tip counts, session counts, percentiles, or hybrid cutoffs from these descriptions or illustrative examples.

### Audit before defining the math

Inspect the existing canonical implementation and actual fan-data distributions before choosing fixed, creator-relative, percentile-based, or hybrid rules. Evaluate lifetime spend, single-session contributions, repeated-session spend, repeat visits, calendar recurrence, sample size, outliers, platform scope, creator-local timezone, and Free/Pro entitlement scope.

The preferred direction to evaluate is a hybrid: repeat-session behavior for Regular, large lifetime or unusually large single-session spend for Whale, and meaningful repeat spending below Whale for Shark.

Approve exact formulas, minimum samples, null handling, entitlement behavior, and migration of existing consumers separately before changing behavior. Reuse canonical logic; do not create page-specific classifications.

## Fan risk / dependency

Reuse canonical logic only.

Do not introduce a new threshold on a single page.

Existing product direction includes:
- At-Risk based on fan-specific average-between-days where implemented
- Critical based on more severe inactivity
- dependency thresholds should use the canonical source, not page-local copies

## Earnings rates

- `$ / hour` uses actual known streamed duration.
- Unknown duration is excluded from rate denominators.
- Do not replace unknown duration with zero.
- Do not infer a full stream length from first/last tip timestamps unless the canonical implementation explicitly labels that as an estimate.

## Platform normalization

Use the canonical platform display/normalization utilities.

Do not introduce new spellings or casing variants.

Examples of expected display identities include:
- Chaturbate
- BongaCams
- MyFreeCams

## Stream Planner and recommendations

- Use the existing canonical recommendation logic.
- Do not equate a saved planned stream with a historical recommendation unless the data model explicitly proves that relationship.
- Do not claim that a creator “followed a recommendation” unless the relevant recommendation provenance exists.
- Do not compare recommendation-hit vs off-plan performance unless both the recommendation provenance and sufficient samples exist.

## Performance classifications

Do not invent new five-band or multi-band performance classifications.

If the repo currently supports only above/below/par or another existing classification, preserve it.

Any new classification requires:
- exact formula
- sample rule
- null handling
- platform-aware considerations
- approval
- canonical implementation and tests

## Insights

Every insight must be traceable to:
- source data
- calculation
- minimum sample
- fallback

Do not invent:
- strong start
- optimal duration
- best session type
- recommended-window effect
- Live Mode effect
- platform effect
- fan effect

unless the underlying data and canonical logic support the claim.

## Correlation language

Use non-causal language unless a supported causal methodology exists.

Preferred:
- “associated with”
- “tends to”
- “in your recent sessions”
- “sessions matching this condition averaged…”

## Low-data behavior

Low-data accounts must receive truthful descriptive states rather than fabricated analytics.

Examples:
- “Not enough sessions yet”
- “More data needed for comparison”
- “No reliable baseline yet”
- “Recommendation unavailable”

## High-data behavior

High-data accounts may use richer segmentation only when:
- canonical logic supports it
- sample guards are satisfied
- the calculation remains performant
- the entitlement scope permits the data used
