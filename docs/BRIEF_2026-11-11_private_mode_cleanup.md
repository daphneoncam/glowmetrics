# Brief: Private Mode production check + legacy function cleanup

Dates: check 2026-11-06, cleanup 2026-11-11. Production Supabase `hlsdlaibnayzbfflxclj`, Vercel `glowmetrics-ggsb`.

## Private Mode is live
- Website: in production since PR #703. The current production deploy is `31bb6a3` (PR #794). The UI is `app/live/PrivateShowControl.js` on `/dashboard` and `/live`.
- Database: migration `20261103_live_mode_free_allowance_and_private_mode` was applied 2026-11-04. `live_private_intervals.username` exists. The 3-argument `start_private_interval(rate, platform, username)` requires a username, caps the rate at 1000, and checks the platform against the running session.
- `live_private_intervals` has 0 rows. No one has used Private Mode in production yet.

## Findings
1. **HIGH: the legacy `start_private_interval(numeric, text)` is still in production.** Any signed-in user can call it. It skips the username requirement, has no rate cap, and saves the caller's platform verbatim. That could put bad data into private earnings figures, for the caller's own rows only. No code calls it: routes, client and both extension builds were checked against `main` @ `31bb6a3`. The owner approved dropping it.
   - Migration `20261111_drop_legacy_start_private_interval.sql` was written.
   - **Status: NOT YET APPLIED.** The first attempt timed out waiting for the owner's confirmation in Supabase. Production is unchanged.
2. **MEDIUM: the Free 2-platform limit is not enforced by the database.** PR #794 (website) is live. `20261110_free_tier_two_platform_limit.sql` is not applied. It also only replaces `enforce_free_tier_platform_limit()`, and the triggers that ran that function were dropped on 2026-11-04. So applying it would not enforce anything. Only the website enforces the limit. That application-side enforcement has not been audited yet.
3. **INFO:** the stale "NOT YET APPLIED" header in the 20261103 migration is corrected. Comment only.

## Tasks (most important first)
- **New:**
  1. Owner approves the Supabase prompt so the legacy function can be dropped. Then verify only the 3-argument version remains and update the STATUS line in the 20261111 file.
  2. Owner decides how the Free 2-platform limit should be enforced (website only, or the database too). Optionally, audit the website's enforcement.
  3. Owner runs a real Private Mode test. Then confirm the saved row has the username, the canonical platform and the rate.
- **In progress:** dropping the legacy function (file committed, not applied).
- **Completed:** Private Mode production check. Safety re-check against the latest `main`. Migration header comment fix.
