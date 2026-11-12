-- Bring the import-RPC mirror (captured 2026-11-01, already hardened by
-- 20261101) to the exact table/sequence ACLs read from production on
-- 2026-11-05 (pg_class.relacl). On Postgres 17 GRANT ALL includes MAINTAIN
-- (production's 'm'); on 16 MAINTAIN does not exist and is absent:
--   paid_sessions         anon=arwdDxtm  authenticated=arwdDxtm  service_role=arwdDxtm
--   tips                  anon=rxtm      authenticated=arwdDxtm  service_role=arwdDxtm
--   paid_sessions_id_seq  anon=rwU       authenticated=rwU       service_role=rwU
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tips FROM anon;           -- 20261029c (applied in production)
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.paid_sessions_id_seq TO anon, authenticated, service_role;

CREATE TABLE t.acl_baseline AS
SELECT c.relname, a.grantee::regrole::text AS grantee, a.privilege_type
FROM pg_class c, aclexplode(c.relacl) a
WHERE c.oid IN ('public.paid_sessions'::regclass, 'public.tips'::regclass, 'public.paid_sessions_id_seq'::regclass)
  AND a.grantee <> 0;

CREATE FUNCTION t.v17() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT current_setting('server_version_num')::int >= 170000 $f$;
CREATE FUNCTION t.privs(rel text, who text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM t.acl_baseline WHERE relname = rel AND grantee = who $f$;
SELECT t.ok(t.privs('paid_sessions', 'anon') = CASE WHEN t.v17() THEN 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' ELSE 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' END,
            'prod state: anon paid_sessions = arwdDxt' || CASE WHEN t.v17() THEN 'm (exact production ACL)' ELSE ' (no MAINTAIN on 16)' END);
SELECT t.ok(t.privs('tips', 'anon') = CASE WHEN t.v17() THEN 'MAINTAIN,REFERENCES,SELECT,TRIGGER' ELSE 'REFERENCES,SELECT,TRIGGER' END,
            'prod state: anon tips = rxt' || CASE WHEN t.v17() THEN 'm (exact production ACL)' ELSE ' (no MAINTAIN on 16)' END);
SELECT t.ok(t.privs('tips', 'authenticated') = CASE WHEN t.v17() THEN 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' ELSE 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' END,
            'prod state: authenticated tips = arwdDxt' || CASE WHEN t.v17() THEN 'm (exact production ACL)' ELSE ' (no MAINTAIN on 16)' END);
SELECT t.ok((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM t.acl_baseline WHERE relname = 'paid_sessions_id_seq' AND grantee = 'anon')
            = 'SELECT,UPDATE,USAGE', 'prod state: anon paid_sessions_id_seq = rwU');
