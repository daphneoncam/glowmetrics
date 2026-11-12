# Formula Integrity Check

**Run timestamp (UTC):** 2026-07-21T14:30:00Z
**Window checked:** commits since 2026-07-21 04:04 UTC (~12h lookback, no prior audit file existed)
**Commits reviewed:** 4

| SHA | Time (UTC) | Title |
|---|---|---|
| fbba39b | 2026-07-21 12:00 | Track Chrome extension installs, downloads, and active usage (#282) |
| ecf373c | 2026-07-21 13:16 | Add Creator Profile Studio: free Cam Bio + Tip Menu Generator (#283) |
| fa300f6 | 2026-07-21 13:37 | Add files via upload (blog images only) |
| 8eb8e5a | 2026-07-21 14:08 | Link Creator Profile Studio from top-trending pages + Etsy cross-promo (#284) |

## Result: ✅ No new violations found

Checked against all six categories:

1. **Token-to-USD math outside `lib/constants.js`** — none. `lib/profileStudio/constants.js` imports `PLATFORM_TOKEN_RATES` / `DEFAULT_TOKEN_RATE` / `tokenRate` from `lib/constants.js` rather than redefining rates. `pricingEngine.js#estimateEarnings()` multiplies by a `tokenValue` that always originates from `defaultTokenValue()` (constants.js-sourced), not a hardcoded rate.
2. **New $/hr, session-duration, or "hours online" calc outside the shared analytics layer** — none. The Tip Menu Generator's "Earnings goal per hour" field is a raw user-typed input passed to the AI prompt (marketing-copy generation), not a computed metric derived from real session/tip data, and it doesn't touch `lib/analytics.js`'s `calculateHourlyRate()` domain.
3. **New dedup logic (SQL/JS) bypassing the canonical dedup key** — none found in the reviewed diffs.
4. **New "best"/"peak" calc done client-side instead of shared layer** — none. Pricing-tier weighting in `pricingEngine.js` (`buildPricingSlots`) is deterministic tip-menu pricing for a content-generation tool, not a stream-time/"best hour" analytics claim.
5. **New revenue-type classification logic duplicated instead of imported** — none. No new code classifies real tip/session revenue events (manual_tip/private_chat/etc.); Profile Studio operates on hypothetical menu items, not imported revenue data.
6. **Commit touching a protected file directly (e.g. `onboarding/page.js`) without a reviewed PR** — none. File lists for all 4 commits reviewed; `onboarding/page.js` not touched. `ecf373c` and `8eb8e5a` were merged via PR (#283, #284 — squash-merge commit messages reference PR numbers); no protected file involved regardless.

## Notes (informational, not a violation)

- `lib/profileStudio/tipMenuRules.js` zod schema has `tokenValue: z.number().positive().max(10).default(0.05)` as a validation-layer fallback default. It's never used for computation on its own — the client always supplies a real `tokenValue` sourced from `defaultTokenValue()`/`lib/constants.js`. Low-risk, but if `DEFAULT_TOKEN_RATE` in `lib/constants.js` ever changes, this schema default would silently drift out of sync. Worth a follow-up cleanup (import the constant instead of a literal), not urgent.

## Commits reviewed: 4
