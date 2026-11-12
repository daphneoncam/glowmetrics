# Creator Report — Entitlement Spec (design document, not implemented)

Per-value disposition, based on the full trace delivered in the prior investigative report.

| Value | Current source | Currently gated? | Disposition |
|---|---|---|---|
| Total Earnings | `analytics.totalUSD` | Free (correct, no change) | **FREE** |
| Avg $/Hour | `analytics.estimatedHourlyRate` | **Not gated at all today** | **PRO** — matches every other exact-$/hr figure elsewhere in the app; Free sees a qualitative substitute ("your hourly rate is trackable — Pro shows the exact number") or the card is simply omitted from the Free layout rather than shown with a real number |
| Best Streaming Day | `analytics.bestDay` | Not gated | **FREE PREVIEW** — the day name alone (no $ figure) is closer to the "directional signal" pattern already proven acceptable for Daily Brief; the `~$X avg` sub-value moves to Pro |
| Best Streaming Time | `analytics.bestHour` (exact hour + avg $) | Not gated | **PRO** — this is literally the Daily Brief figure, duplicated here with zero gate; once the canonical best-time service exists, this card should read from it with the same redaction Daily Brief gets, not a separate decision |
| Top Supporter | `topTippers[0]` | Not gated | **FREE** — consistent with the top-1/top-3 pattern already used elsewhere (Top Fans shows 3; showing the single top supporter here is a smaller, consistent free allowance) |
| Most Profitable Platform (name) | `topPlatform`/`canonicalBestPlatform` | Not gated | **FREE PREVIEW** — the platform name alone, no $/hr |
| Most Profitable Platform ($/hr) | `topPlatform.usdPerHour` | **Not gated once 2+ platforms exist** | **PRO** — matches the Platforms tab's own $/hr gate; the softening copy currently only appears when it's irrelevant (1 platform) and should instead appear exactly when the real number would otherwise show |
| `opportunityInsight`/`warningInsight` (from `generateInsights()`) | `analytics.insights` | Not gated, not exhaustively traced this session for content specifics | **REASSESS** — likely Pro-caliber content by the same pattern as everything else on this list, but the exact text `generateInsights()` produces wasn't read line-by-line this pass; verify before finalizing rather than assuming |
| Next-moves #1 | `analytics.nextMoves[0]` | Free (correct, no change) | **FREE** |
| Next-moves #2+ | `analytics.nextMoves[1+]` | **CSS `blur(3px)`, real text in DOM** — confirmed the weakest gate in the app | **PRO**, server-redacted — the array itself should arrive already truncated to length 1 for Free, not truncated visually |

## Net effect

Of six stat cards, Creator Report's Free version currently shows **four** real Pro-caliber
figures unconditionally (Avg $/Hour, exact Best Streaming Time, and — once 2+ platforms exist
— the $/hr on Most Profitable Platform, plus the un-truncated `insights` array feeding two
callout boxes). Under this spec, Free's stat grid shrinks to Total Earnings, Top Supporter,
and two platform/day *names* without their $ figures — still a genuinely useful summary, not
an empty page, consistent with the "Free = discovery" principle already established.

## What Creator Report should retain vs. what moves to Opportunities

Per the architecture's stated goal, Creator Report stays the **summary rollup** — headline
numbers plus a pointer into the deeper surfaces. The exact $/hr, exact best-hour, and full
insight/next-moves detail are exactly the kind of content the new Opportunities page is meant
to own; Creator Report's role after this redesign is to *reference* that content ("2
opportunities found — see Opportunities") rather than *contain* it, avoiding recreating the
same leak in a renamed location.

---
No code changed. No UI changed. Spec only.
