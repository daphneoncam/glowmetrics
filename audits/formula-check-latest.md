# Formula Integrity Check

- Run timestamp (UTC): 2026-07-20T16:03:47Z
- Window checked: commits since 2026-07-19 ~21:04 -0700 (~12h, no prior audit file existed)
- HEAD at check time: cffd334c864d3bc64d1e1b948522a24069c54fbb
- Commits reviewed: 6
  - cffd334 Add Live Mode coaching Phase 1: session earnings fields + live_session_pauses (#277)
  - b47fd14 feat(session-hub): Phase 1 data model (#274)
  - b323d75 seo(blog): target "how much do Chaturbate models make" (#273)
  - 29633d2 Flesh out cam-model-income-tracker guide (#276)
  - 1c41b1d fix(dashboard): sidebar Upgrade to Pro link (#272)
  - 52d439f feat(live-mode): automatic missed-heartbeat detection and auto-end (#271)

## Result: 1 VIOLATION FOUND

### Violation — new $/hr calculation outside the shared analytics layer

- **File:** `glowmetrics_fresh/supabase/migrations/20260720e_add_live_mode_coaching_phase1_session_fields.sql`
- **Lines:** 251–252 (values fed by `v_active_secs` at line 232 and `v_earnings`/`v_tip_count` aggregated at ~244–249), inside `stop_live_session()`
- **What it does:**
  ```sql
  earnings_per_active_hour = CASE WHEN v_active_secs > 0 THEN round((v_earnings / (v_active_secs / 3600.0))::numeric, 2) ELSE 0 END,
  tips_per_active_hour     = CASE WHEN v_active_secs > 0 THEN round((v_tip_count / (v_active_secs / 3600.0))::numeric, 2) ELSE 0 END
  ```
  This Postgres RPC independently computes a totalUSD-per-hour (and tips-per-hour) figure and writes it into new `live_sessions.earnings_per_active_hour` / `tips_per_active_hour` columns.
- **How it diverges:** `formula-requirments` designates `lib/analytics.js` → `calculateHourlyRate()` as the single source of truth for `Hourly Rate = totalUSD / streamedHours`, applied only to valid sessions (`durationMinutes >= 30 AND tipCount >= 2`) and displayed with exact/estimated/"Not enough data yet" labeling. This migration reimplements the same division directly in SQL, in a new code path, with no valid-session gate and no confidence/estimated labeling — a second, divergent implementation of the hourly-rate formula outside the shared analytics layer.
- **Not flagged as a false positive:** the migration's own comment claims direct aggregation from `live_tips` is "the already-proven, robust mechanism this engine uses everywhere else," but that precedent is for *attribution* (which tips belong to a session), not for the *hourly-rate division formula* itself, which is explicitly reserved to the shared JS layer.

No fix applied — read-only check per routine instructions. Flagging for review.

## Other commits in window — no new violations
- `b47fd14` (session-hub Phase 1): schema-only migration (tables/columns for coaching events, corrections, analysis context). Includes an `actual_hourly_rate` column and a `dedupe_key` column, but neither is populated or computed by this migration — no RPC/logic writes to them yet. Commit description confirms "no earnings-impact/effectiveness conclusions are built in this phase." Nothing to flag until a future commit populates these with divergent logic — worth checking again next run.
- `52d439f` (missed-heartbeat auto-end): session lifecycle/state-machine changes (`sweep_stale_live_session()`, heartbeat RPCs) — status transitions and backdating `ended_at`, not a revenue/hourly/dedup calculation. No violation.
- `1c41b1d`, `b323d75`, `29633d2`: UI link fix and blog/SEO copy only. `onboarding/page.js` (protected file) not touched. No calculation logic changed.

## Email
Attempted to send via Resend to daphneoncam@gmail.com per routine instructions — no `RESEND_API_KEY` credential is available in this session/environment, so the send could not be completed. Flagged to the user via push notification instead.
