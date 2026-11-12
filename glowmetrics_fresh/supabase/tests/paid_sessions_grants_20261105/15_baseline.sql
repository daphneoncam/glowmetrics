-- BEFORE the migration: prove each hole exists on the production-shaped
-- mirror. LOCAL DISPOSABLE DATABASE ONLY. Everything is rolled back.
SELECT t.assert_history_unchanged('baseline start');

BEGIN; SET LOCAL ROLE anon;
TRUNCATE public.paid_sessions;
RESET ROLE;
SELECT t.ok((SELECT count(*) FROM public.paid_sessions) = 0, 'baseline: anon CAN truncate paid_sessions for every user despite RLS');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
TRUNCATE public.tips;
RESET ROLE;
SELECT t.ok((SELECT count(*) FROM public.tips) = 0, 'baseline: a signed-in user CAN truncate tips for every user despite RLS');
ROLLBACK;

BEGIN; SET LOCAL ROLE anon;
SELECT setval('public.paid_sessions_id_seq', 1);
RESET ROLE;
SELECT t.ok((SELECT last_value FROM public.paid_sessions_id_seq) = 1, 'baseline: anon CAN rewind paid_sessions_id_seq (setval)');
ROLLBACK;
-- Sequence changes are NOT undone by ROLLBACK: the rewind persists, and the
-- next private-earnings import collides with existing ids. The import RPC
-- uses ON CONFLICT DO NOTHING, so the rows are SILENTLY SKIPPED.
SELECT t.ok((SELECT last_value FROM public.paid_sessions_id_seq) = 1, 'baseline: the anon rewind survives ROLLBACK (sequences are not transactional)');
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE rewind_effect AS SELECT public.insert_paid_sessions_dedup('[{"user_id":"00000000-0000-0000-0000-00000000000a","date_time":"2026-05-01T00:00:00Z","platform":"Chaturbate","username":"after_rewind","session_type":"Private Chat","tokens":100,"usd":5}]'::jsonb) AS res;
RESET ROLE;
SELECT t.ok((SELECT (res->>'inserted')::int = 0 AND (res->>'skipped')::int = 1 FROM rewind_effect), 'baseline: after the anon rewind, a real private-earnings import is SILENTLY SKIPPED (data loss)');
ROLLBACK;
SELECT setval('public.paid_sessions_id_seq', (SELECT max(id) FROM public.paid_sessions)); -- restore (superuser)

BEGIN; SET LOCAL ROLE anon;
LOCK TABLE public.paid_sessions IN ACCESS EXCLUSIVE MODE;
RESET ROLE;
SELECT t.ok(true, 'baseline: anon CAN take an ACCESS EXCLUSIVE lock on paid_sessions');
ROLLBACK;

-- Postgres 17 only: MAINTAIN alone (anon on tips holds no write privilege)
-- allows an ACCESS EXCLUSIVE lock. (ANALYZE is not used as evidence: without
-- the privilege Postgres only warns and skips the table, it does not fail.)
DO $v17$
BEGIN
  IF NOT t.v17() THEN RAISE NOTICE 'SKIP (Postgres < 17): MAINTAIN baseline'; RETURN; END IF;
  SET LOCAL ROLE anon;
  LOCK TABLE public.tips IN ACCESS EXCLUSIVE MODE;
  RESET ROLE;
  RAISE NOTICE 'PASS: baseline (17): anon CAN take an ACCESS EXCLUSIVE lock on tips via MAINTAIN alone';
END $v17$;

SELECT t.assert_history_unchanged('baseline end (all rolled back)');
