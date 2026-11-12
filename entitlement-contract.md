# Entitlement Contract (design document, not implemented)

## The shared shape

```json
// Free (unlocked: false)
{
  "unlocked": false,
  "preview": {
    "category": "timing | missed_revenue | fan_retention | platform | session",
    "summary": "qualitative, honest, non-manipulative description",
    "count": 3
  }
}

// Pro (unlocked: true)
{
  "unlocked": true,
  "data": {
    // full insight payload — exact figures, names, recommendations
  }
}
```

This mirrors the pattern `get_user_insights` already implements (PR #407): compute the full
result once, then branch what's *returned* based on `profiles.plan`/`plan_expires_at` — never
compute a reduced version separately, and never send the full payload with a client-side flag
saying "don't render this." The redaction happens server-side, before the response leaves the
database/API boundary.

## Concretely, per insight category (building on the duplication map + monetization map)

| Insight | Free `preview.summary` shape | Pro `data` shape |
|---|---|---|
| Daily Brief / best-time | "You have a predictable earning pattern" + real-time in-window boolean (already correct, PR #407) | Exact hour, $ range, day×hour grid once extended |
| Missed revenue | "You have sessions that underperformed your peak window" | Exact $ figure, exact hour, per-platform breakdown |
| Fan/churn intelligence | "N fans may be going cold" (count only) | Named fans, $ lifetime value, churn-risk level, suggested action |
| Platform comparison | Totals/hours per platform (unchanged — already free by design) | $/hr, avg tip size, "Nx more" comparison narrative |
| Session opportunity | Raw timeline + one qualitative performance flag | Causal breakdown, specific recommendation |
| Next-moves/recommendations | Move #1 in full | Full list |

## What this requires that doesn't exist today

A single shared server-side function/module that takes `(insight_type, raw_result, is_pro)`
and returns the branched shape above — used by every insight category, not reimplemented per
category the way `get_user_insights` currently does its one redaction inline. This is the
"reusable server-side entitlement/redaction mechanism" requested — a genuine gap, since right
now the only precedent (`get_user_insights`) hand-codes its own redaction rather than calling
a shared helper.

## Non-negotiables, restated as verification criteria

- The Free response must never contain the Pro `data` object, not even nulled-out-but-present
  keys that a client could infer structure from — omit the key entirely, don't send `null`
  for something whose mere presence-with-a-value-elsewhere leaks the schema.
- No CSS/JSX-only gate is a substitute for this contract, for any *new* surface built under
  this architecture — the CreatorReport/StreamPlanner blur gates are legacy, not the pattern
  going forward.
- Ownership check (`auth.uid()` = target user) travels with every server-side insight
  function, per the pattern already fixed in `get_user_insights` this session — not optional,
  not assumed.

---
No code changed. Design document only.
