# Migration checklist (CamCash / Supabase)

Copy into every migration PR description and tick each line.

## Before writing
- [ ] Read production's current state read-only first (columns, constraints, grants, RLS policies, function bodies). Never assume the repo matches production. The recorded migration history is known to differ from the repo.
- [ ] Production is PostgreSQL 17. Privileges that exist only on 17 (MAINTAIN) need a `server_version_num >= 170000` guard if the rehearsal runs on 16.

## Privileges (default privileges narrowed by 20261106; nothing is granted implicitly)
- [ ] Every new **table**: explicit `GRANT` per role.
  - anon: usually none, or `SELECT` only when a public read is intended (RLS still applies).
  - authenticated: only the verbs the app uses (`SELECT` / `INSERT` / `UPDATE` / `DELETE`). **Never TRUNCATE or MAINTAIN.**
  - service_role: as needed.
- [ ] Every new **sequence**: anon gets nothing; authenticated gets `USAGE` only if it inserts directly. Nobody but the owner and service_role gets `UPDATE` (setval).
- [ ] Every new **function**: `REVOKE ALL ON FUNCTION … FROM PUBLIC`, then `GRANT EXECUTE` to the exact roles. New functions are executable by PUBLIC by default.
- [ ] `SECURITY DEFINER` functions: `SET search_path`, an ownership check using `IS DISTINCT FROM auth.uid()` (a NULL caller must fail), and no dynamic SQL built from input.
- [ ] RLS enabled on every user-data table, with a policy per verb. Remember: RLS does not limit TRUNCATE, MAINTAIN/LOCK or sequences.

## Safety
- [ ] Wrapped in `BEGIN … COMMIT` with `SET LOCAL lock_timeout`.
- [ ] Ends with a verification block that aborts if the intended state is not reached and if anything the app needs was removed.
- [ ] Idempotent (safe to run twice), or refuses a second run with a clear preflight error.
- [ ] Rollback script in `supabase/rollbacks/` that restores the exact previous state, and is verified.
- [ ] Rehearsal under `supabase/tests/<name>/run.sh` on a disposable local Postgres that refuses Supabase hosts. Run on 17.
- [ ] No money or analytics values change unless that is the approved purpose. If one could, snapshot counts and totals before and after.

## Applying
- [ ] Applied to production only with explicit owner approval, and recorded in the migration history (not run ad hoc).
- [ ] Merging a PR does not apply migrations. Confirm the Supabase GitHub integration setting before relying on that.
