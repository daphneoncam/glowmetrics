-- AFTER the migration.
CREATE TABLE public.probe_after (id bigserial PRIMARY KEY);
SELECT t.ok(t.privs('public.probe_after', 'anon') = 'REFERENCES,SELECT,TRIGGER', 'after: a new table gives anon only SELECT/REFERENCES/TRIGGER');
SELECT t.ok(t.privs('public.probe_after', 'authenticated') = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE', 'after: a new table gives authenticated no TRUNCATE' || CASE WHEN t.v17() THEN '/MAINTAIN' ELSE '' END);
SELECT t.ok(t.privs('public.probe_after', 'service_role') = CASE WHEN t.v17() THEN 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' ELSE 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' END,
            'after: service_role defaults unchanged');
SELECT t.ok(t.privs('public.probe_after_id_seq', 'anon') = 'SELECT', 'after: a new sequence gives anon no UPDATE/USAGE');
SELECT t.ok(t.privs('public.probe_after_id_seq', 'authenticated') = 'SELECT,USAGE', 'after: a new sequence gives authenticated no UPDATE (setval)');

BEGIN; SET LOCAL ROLE anon;
DO $d$ BEGIN
  BEGIN TRUNCATE public.probe_after; RAISE EXCEPTION 'FAIL: anon truncated a new table';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: after: anon TRUNCATE on a new table is denied (42501)'; END;
  BEGIN INSERT INTO public.probe_after DEFAULT VALUES; RAISE EXCEPTION 'FAIL: anon inserted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: after: anon INSERT on a new table is denied (42501)'; END;
  BEGIN PERFORM setval('public.probe_after_id_seq', 1); RAISE EXCEPTION 'FAIL: anon setval';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: after: anon setval on a new sequence is denied (42501)'; END;
END $d$;
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
DO $d$ BEGIN
  BEGIN TRUNCATE public.probe_after; RAISE EXCEPTION 'FAIL: authenticated truncated a new table';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: after: authenticated TRUNCATE on a new table is denied (42501)'; END;
END $d$;
ROLLBACK;

-- existing objects keep exactly their grants
SELECT t.ok(NOT EXISTS (
  (SELECT * FROM t.acl_existing EXCEPT SELECT c.relname, a.grantee::regrole::text, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'public'::regnamespace AND a.grantee <> 0 AND c.relname IN (SELECT relname FROM t.acl_existing))
  UNION ALL
  (SELECT c.relname, a.grantee::regrole::text, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'public'::regnamespace AND a.grantee <> 0 AND c.relname IN (SELECT relname FROM t.acl_existing) EXCEPT SELECT * FROM t.acl_existing)),
  'after: existing tables and sequences keep exactly their grants');

-- Why functions are out of scope: revoking anon in the schema-level default
-- does not stop anon executing a new function, because the GLOBAL default
-- grants EXECUTE to PUBLIC.
BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
CREATE FUNCTION public.probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT t.ok(has_function_privilege('anon', 'public.probe_fn()', 'EXECUTE'), 'scope note: a schema-level revoke from anon does NOT stop anon executing new functions (PUBLIC global default)');
ROLLBACK;
