-- Harden table/sequence privileges on the earnings tables (paid_sessions, tips).
-- Follow-up to 20261029c (#711), which removed anon INSERT/UPDATE/DELETE/TRUNCATE
-- on tips/live_tips/coaching_events but deliberately left paid_sessions.
--
-- Production, read-only audit 2026-11-05 (pg_class.relacl):
--   paid_sessions         anon=arwdDxtm  authenticated=arwdDxtm  service_role=arwdDxtm
--   tips                  anon=rxtm      authenticated=arwdDxtm  service_role=arwdDxtm
--   paid_sessions_id_seq  anon=rwU       authenticated=rwU       service_role=rwU
-- RLS (enabled, not forced) limits ROWS for anon/authenticated, but these
-- privileges are not subject to RLS:
--   * TRUNCATE  — empties the table for EVERY user in one statement;
--   * MAINTAIN  — (Postgres 17) VACUUM/ANALYZE/REINDEX/CLUSTER and LOCK TABLE,
--                 e.g. an ACCESS EXCLUSIVE lock that blocks every dashboard read;
--   * sequence UPDATE — setval() can rewind ids so later inserts collide.
-- No API path to these exists today (PostgREST has no TRUNCATE/LOCK verb,
-- pg_graphql is not installed, no anon-executable function runs dynamic SQL),
-- but that is an absence of a path, not a privilege boundary.
--
-- No code path needs any revoked privilege:
--   imports      -> insert_paid_sessions_dedup / insert_tips_dedup (SECURITY
--                   DEFINER, owner postgres) called as authenticated;
--   dashboard    -> SELECT own rows (authenticated);
--   delete tip / delete all tips -> DELETE own rows (authenticated, RLS);
--   admin stats  -> service_role.
--
-- Scope (narrow):
--   anon:          paid_sessions  -INSERT -UPDATE -DELETE -TRUNCATE -MAINTAIN
--                  tips           -MAINTAIN
--                  paid_sessions_id_seq -UPDATE -USAGE
--   authenticated: paid_sessions, tips -TRUNCATE -MAINTAIN
--                  paid_sessions_id_seq -UPDATE
-- Unchanged: anon SELECT/REFERENCES/TRIGGER (RLS returns 0 rows; separate
-- follow-up), authenticated SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER,
-- every service_role privilege, tips_id_seq, default privileges.
--
-- Known residual (NOT closed here): in Postgres 17, LOCK TABLE ... ACCESS
-- EXCLUSIVE is also allowed by UPDATE or DELETE. authenticated keeps DELETE
-- (own-row deletes) and UPDATE on tips, so a signed-in session able to run raw
-- SQL could still lock these tables. Closing that needs own-row deletes moved
-- behind SECURITY DEFINER RPCs (separate design).
--
-- MAINTAIN exists only on Postgres >= 17 (production); on older servers (the
-- local rehearsal runs 16) those statements are skipped.
--
-- Rollback: supabase/rollbacks/20261105_harden_earnings_table_grants.rollback.sql
-- Rehearsal (disposable local Postgres only): supabase/tests/paid_sessions_grants_20261105/run.sh

BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.paid_sessions FROM anon;
REVOKE UPDATE, USAGE ON SEQUENCE public.paid_sessions_id_seq FROM anon;
REVOKE TRUNCATE ON public.paid_sessions FROM authenticated;
REVOKE TRUNCATE ON public.tips          FROM authenticated;
REVOKE UPDATE ON SEQUENCE public.paid_sessions_id_seq FROM authenticated;

DO $maintain$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON public.paid_sessions FROM anon, authenticated';
    EXECUTE 'REVOKE MAINTAIN ON public.tips FROM anon, authenticated';
  END IF;
END $maintain$;

DO $verify$
DECLARE r record; v17 boolean := current_setting('server_version_num')::int >= 170000;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('anon','public.paid_sessions','INSERT'), ('anon','public.paid_sessions','UPDATE'),
      ('anon','public.paid_sessions','DELETE'), ('anon','public.paid_sessions','TRUNCATE'),
      ('authenticated','public.paid_sessions','TRUNCATE'), ('authenticated','public.tips','TRUNCATE')) v(role, tbl, priv)
  LOOP
    IF has_table_privilege(r.role, r.tbl, r.priv) THEN
      RAISE EXCEPTION 'Verify failed: % still has % on %', r.role, r.priv, r.tbl;
    END IF;
  END LOOP;
  IF v17 THEN
    FOR r IN SELECT * FROM (VALUES ('anon','public.paid_sessions'), ('anon','public.tips'),
                                   ('authenticated','public.paid_sessions'), ('authenticated','public.tips')) v(role, tbl)
    LOOP
      IF has_table_privilege(r.role, r.tbl, 'MAINTAIN') THEN
        RAISE EXCEPTION 'Verify failed: % still has MAINTAIN on %', r.role, r.tbl;
      END IF;
    END LOOP;
  END IF;
  IF has_sequence_privilege('anon', 'public.paid_sessions_id_seq', 'UPDATE')
     OR has_sequence_privilege('anon', 'public.paid_sessions_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.paid_sessions_id_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'Verify failed: paid_sessions_id_seq privileges not revoked';
  END IF;
  -- privileges the app depends on must remain
  FOR r IN SELECT * FROM (VALUES
      ('authenticated','public.paid_sessions','SELECT'), ('authenticated','public.paid_sessions','INSERT'),
      ('authenticated','public.paid_sessions','DELETE'),
      ('authenticated','public.tips','SELECT'), ('authenticated','public.tips','INSERT'),
      ('authenticated','public.tips','UPDATE'), ('authenticated','public.tips','DELETE'),
      ('anon','public.paid_sessions','SELECT'), ('anon','public.tips','SELECT'),
      ('service_role','public.paid_sessions','TRUNCATE'), ('service_role','public.tips','TRUNCATE'),
      ('service_role','public.paid_sessions','DELETE'), ('service_role','public.tips','DELETE')) v(role, tbl, priv)
  LOOP
    IF NOT has_table_privilege(r.role, r.tbl, r.priv) THEN
      RAISE EXCEPTION 'Verify failed: % lost % on %', r.role, r.priv, r.tbl;
    END IF;
  END LOOP;
  IF NOT has_sequence_privilege('service_role', 'public.paid_sessions_id_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'Verify failed: service_role lost sequence UPDATE';
  END IF;
END $verify$;

COMMIT;
