-- Rollback for 20261106_narrow_public_default_privileges.sql: restores the
-- production defaults recorded on 2026-11-05 (FOR ROLE postgres IN SCHEMA public):
--   tables anon=arwdDxtm authenticated=arwdDxtm; sequences anon=rwU authenticated=rwU.
-- Objects created while the narrower defaults were active keep their grants.
BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE, USAGE ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO authenticated;
DO $maintain$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO anon, authenticated';
  END IF;
END $maintain$;
COMMIT;
