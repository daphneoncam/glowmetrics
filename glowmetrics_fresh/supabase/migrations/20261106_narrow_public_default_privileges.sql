-- Narrow the DEFAULT privileges that objects created by `postgres` in schema
-- public receive. Affects ONLY tables/sequences created AFTER this runs;
-- existing objects keep their current grants (fixed separately, e.g. #755).
--
-- Production, read-only (pg_default_acl, 2026-11-05), FOR ROLE postgres IN SCHEMA public:
--   tables     anon=arwdDxtm authenticated=arwdDxtm service_role=arwdDxtm
--   sequences  anon=rwU      authenticated=rwU      service_role=rwU
--   functions  anon=X        authenticated=X        service_role=X
-- So every new table silently gives the anon key INSERT/UPDATE/DELETE/
-- TRUNCATE/MAINTAIN, and every new sequence gives setval(). RLS does not
-- cover TRUNCATE, MAINTAIN/LOCK or sequences.
--
-- Scope (approved, narrow):
--   tables:    anon          -INSERT -UPDATE -DELETE -TRUNCATE -MAINTAIN
--              authenticated -TRUNCATE -MAINTAIN
--   sequences: anon          -UPDATE -USAGE
--              authenticated -UPDATE
-- Kept: anon SELECT/REFERENCES/TRIGGER and authenticated SELECT/INSERT/UPDATE/
-- DELETE/REFERENCES/TRIGGER on new tables (RLS still governs rows), all
-- service_role defaults, sequence SELECT.
-- NOT changed:
--   * supabase_admin defaults (not our role; Supabase-managed objects rely on them).
--   * Function EXECUTE: new functions are executable by PUBLIC through the
--     GLOBAL default, which every role inherits, so revoking anon here would
--     not take effect (the rehearsal proves this). Changing the global default
--     affects every schema and is a separate decision.
-- Consequence: a new table/sequence that anon must write, or that a signed-in
-- user must truncate, needs an explicit GRANT (fails closed with 42501).
-- See supabase/MIGRATION_CHECKLIST.md.
--
-- MAINTAIN exists only on Postgres >= 17 (production 17.6).
-- Rollback: supabase/rollbacks/20261106_narrow_public_default_privileges.rollback.sql
-- Rehearsal: supabase/tests/default_privileges_20261105/run.sh (disposable local Postgres only)

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE, USAGE ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM authenticated;

DO $maintain$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM anon, authenticated';
  END IF;
END $maintain$;

-- Verify against pg_default_acl itself.
DO $verify$
DECLARE
  tbl_anon text; tbl_auth text; tbl_svc text; seq_anon text; seq_auth text;
  agg text := $q$SELECT coalesce(string_agg(a.privilege_type, ',' ORDER BY a.privilege_type), '')
                FROM pg_default_acl d, aclexplode(d.defaclacl) a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
                  AND d.defaclobjtype = $1 AND a.grantee = $2::regrole$q$;
  v17 boolean := current_setting('server_version_num')::int >= 170000;
BEGIN
  EXECUTE agg INTO tbl_anon USING 'r', 'anon';
  EXECUTE agg INTO tbl_auth USING 'r', 'authenticated';
  EXECUTE agg INTO tbl_svc  USING 'r', 'service_role';
  EXECUTE agg INTO seq_anon USING 'S', 'anon';
  EXECUTE agg INTO seq_auth USING 'S', 'authenticated';
  IF tbl_anon <> 'REFERENCES,SELECT,TRIGGER' THEN RAISE EXCEPTION 'Verify failed: anon table defaults = %', tbl_anon; END IF;
  IF tbl_auth <> 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE' THEN RAISE EXCEPTION 'Verify failed: authenticated table defaults = %', tbl_auth; END IF;
  IF tbl_svc NOT IN ('DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE', 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE') THEN
    RAISE EXCEPTION 'Verify failed: service_role table defaults changed = %', tbl_svc;
  END IF;
  IF v17 AND position('MAINTAIN' in tbl_svc) = 0 THEN RAISE EXCEPTION 'Verify failed: service_role lost MAINTAIN default'; END IF;
  IF seq_anon <> 'SELECT' THEN RAISE EXCEPTION 'Verify failed: anon sequence defaults = %', seq_anon; END IF;
  IF seq_auth <> 'SELECT,USAGE' THEN RAISE EXCEPTION 'Verify failed: authenticated sequence defaults = %', seq_auth; END IF;
END $verify$;

COMMIT;
