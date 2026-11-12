-- Rollback for 20261105_harden_earnings_table_grants.sql.
-- Restores exactly the production privileges recorded on 2026-11-05:
--   paid_sessions         anon=arwdDxtm  authenticated=arwdDxtm
--   tips                  anon=rxtm      authenticated=arwdDxtm
--   paid_sessions_id_seq  anon=rwU       authenticated=rwU
-- This RE-OPENS the TRUNCATE / LOCK / setval exposure. Use only if the
-- migration breaks a workflow, and re-apply a fix promptly.

BEGIN;
SET LOCAL lock_timeout = '5s';

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.paid_sessions TO anon;
GRANT UPDATE, USAGE ON SEQUENCE public.paid_sessions_id_seq TO anon;
GRANT TRUNCATE ON public.paid_sessions TO authenticated;
GRANT TRUNCATE ON public.tips          TO authenticated;
GRANT UPDATE ON SEQUENCE public.paid_sessions_id_seq TO authenticated;

DO $maintain$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'GRANT MAINTAIN ON public.paid_sessions TO anon, authenticated';
    EXECUTE 'GRANT MAINTAIN ON public.tips TO anon, authenticated';
  END IF;
END $maintain$;

DO $verify$
BEGIN
  IF NOT has_table_privilege('anon', 'public.paid_sessions', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.tips', 'TRUNCATE')
     OR NOT has_sequence_privilege('anon', 'public.paid_sessions_id_seq', 'UPDATE')
     OR NOT has_sequence_privilege('authenticated', 'public.paid_sessions_id_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'Rollback incomplete';
  END IF;
END $verify$;

COMMIT;
