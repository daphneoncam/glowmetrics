-- Disposable local Postgres only. Recreates production's default privileges
-- for objects created by postgres in schema public (pg_default_acl, read
-- 2026-11-05) and two existing tables whose grants must not change.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;      -- arwdDxt(m)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;   -- rwU
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA t;
CREATE FUNCTION t.ok(cond boolean, name text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', name; END IF; RAISE NOTICE 'PASS: %', name; END $f$;
CREATE FUNCTION t.v17() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT current_setting('server_version_num')::int >= 170000 $f$;
-- privileges a role holds on a relation, as a sorted list
CREATE FUNCTION t.privs(rel regclass, who text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(string_agg(a.privilege_type, ',' ORDER BY a.privilege_type), '')
  FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = rel AND a.grantee = who::regrole $f$;
CREATE FUNCTION t.defaults() RETURNS TABLE(objtype "char", grantee text, privilege_type text) LANGUAGE sql STABLE AS $f$
  SELECT d.defaclobjtype, a.grantee::regrole::text, a.privilege_type
  FROM pg_default_acl d, aclexplode(d.defaclacl) a
  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace $f$;

-- existing objects created under the old defaults
CREATE TABLE public.existing_earnings (id bigserial PRIMARY KEY, usd numeric);
CREATE TABLE public.existing_other (id bigserial PRIMARY KEY);

CREATE TABLE t.acl_existing AS
  SELECT c.relname, a.grantee::regrole::text AS grantee, a.privilege_type
  FROM pg_class c, aclexplode(c.relacl) a
  WHERE c.relnamespace = 'public'::regnamespace AND a.grantee <> 0;
CREATE TABLE t.defaults_baseline AS SELECT * FROM t.defaults();
