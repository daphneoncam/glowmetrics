-- AFTER the migration. Every attempt runs in a transaction that is rolled back.
CREATE OR REPLACE FUNCTION t.expect(stmt text, want_denied boolean, label text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE st text := 'ok';
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
  IF want_denied AND st <> '42501' THEN RAISE EXCEPTION 'FAIL: % (sqlstate %, want 42501)', label, st; END IF;
  IF NOT want_denied AND st <> 'ok' THEN RAISE EXCEPTION 'FAIL: % (sqlstate %, want success)', label, st; END IF;
  RAISE NOTICE 'PASS: %', label;
END $f$;
-- test helpers only (schema t exists solely in the disposable rehearsal database)
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION t.expect(text, boolean, text), t.ok(boolean, text), t.v17() TO anon, authenticated, service_role;

-- 1. anon: every write, truncate, lock and sequence change is denied
BEGIN; SET LOCAL ROLE anon;
SELECT t.expect('TRUNCATE public.paid_sessions', true, 'anon: TRUNCATE paid_sessions denied');
SELECT t.expect('TRUNCATE public.tips', true, 'anon: TRUNCATE tips denied');
SELECT t.expect($q$INSERT INTO public.paid_sessions (user_id, date_time, username, session_type) VALUES ('00000000-0000-0000-0000-00000000000a', now(), 'x', 'Private Chat')$q$, true, 'anon: INSERT paid_sessions denied');
SELECT t.expect('UPDATE public.paid_sessions SET usd = 0 WHERE false', true, 'anon: UPDATE paid_sessions denied');
SELECT t.expect('DELETE FROM public.paid_sessions WHERE false', true, 'anon: DELETE paid_sessions denied');
SELECT t.expect('LOCK TABLE public.paid_sessions IN ACCESS EXCLUSIVE MODE', true, 'anon: LOCK paid_sessions denied');
SELECT t.expect('LOCK TABLE public.tips IN ACCESS EXCLUSIVE MODE', true, 'anon: LOCK tips denied (on 17 this also needs MAINTAIN revoked)');
SELECT t.expect($q$SELECT setval('public.paid_sessions_id_seq', 1)$q$, true, 'anon: setval paid_sessions_id_seq denied');
SELECT t.expect($q$SELECT nextval('public.paid_sessions_id_seq')$q$, true, 'anon: nextval paid_sessions_id_seq denied');
SELECT t.expect('SELECT count(*) FROM public.paid_sessions', false, 'anon: SELECT still parses (RLS returns 0 rows)');
SELECT t.ok((SELECT count(*) FROM public.paid_sessions) = 0, 'anon: sees 0 paid_sessions rows (RLS)');
ROLLBACK;

-- 2. authenticated (creator A): no TRUNCATE / setval; features still work
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
SELECT t.expect('TRUNCATE public.paid_sessions', true, 'authenticated: TRUNCATE paid_sessions denied');
SELECT t.expect('TRUNCATE public.tips', true, 'authenticated: TRUNCATE tips denied');
SELECT t.expect($q$SELECT setval('public.paid_sessions_id_seq', 1)$q$, true, 'authenticated: setval paid_sessions_id_seq denied');
-- documented residual: DELETE (needed for own-row deletes) still permits LOCK
SELECT t.expect('LOCK TABLE public.paid_sessions IN ACCESS EXCLUSIVE MODE', false, 'authenticated: LOCK paid_sessions still possible via DELETE (KNOWN RESIDUAL, documented)');
-- import through the RPC (the only write path the app uses)
SELECT t.ok((public.insert_paid_sessions_dedup('[{"user_id":"00000000-0000-0000-0000-00000000000a","date_time":"2026-05-01T00:00:00Z","platform":"Chaturbate","username":"grant_test","session_type":"Private Chat","tokens":100,"usd":5}]'::jsonb) ->> 'inserted')::int = 1,
            'authenticated: private-earnings import via insert_paid_sessions_dedup still works');
SELECT t.ok((public.insert_tips_dedup('[{"user_id":"00000000-0000-0000-0000-00000000000a","date_time":"2026-05-01T00:00:00Z","platform":"Chaturbate","username":"grant_tip","tokens":"5"}]'::jsonb) ->> 'inserted')::int = 1,
            'authenticated: tip import via insert_tips_dedup still works');
SELECT t.ok((SELECT count(*) FROM public.paid_sessions WHERE username = 'grant_test') = 1 AND (SELECT bool_and(user_id = '00000000-0000-0000-0000-00000000000a') FROM public.paid_sessions),
            'authenticated: reads own private earnings only');
SELECT t.ok((SELECT bool_and(user_id = '00000000-0000-0000-0000-00000000000a') FROM public.tips), 'authenticated: reads own tips only');
DELETE FROM public.paid_sessions WHERE username = 'grant_test';
DELETE FROM public.tips WHERE username = 'grant_tip';
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.paid_sessions WHERE username = 'grant_test') AND NOT EXISTS (SELECT 1 FROM public.tips WHERE username = 'grant_tip'),
            'authenticated: deleting own rows (Delete tip / Delete all) still works');
SELECT t.expect('DELETE FROM public.tips WHERE user_id = ''00000000-0000-0000-0000-00000000000b''', false, 'authenticated: DELETE of another user''s tips runs but RLS limits it');
RESET ROLE;
SELECT t.ok((SELECT count(*) FROM public.tips WHERE user_id = '00000000-0000-0000-0000-00000000000b') = 30, 'authenticated: another creator''s 30 tips are untouched');
ROLLBACK;

-- 2b. Postgres 17: MAINTAIN is gone for anon and authenticated (both tables)
DO $v17$
DECLARE r record;
BEGIN
  IF NOT t.v17() THEN RAISE NOTICE 'SKIP (Postgres < 17): MAINTAIN checks'; RETURN; END IF;
  FOR r IN SELECT * FROM (VALUES ('anon','public.paid_sessions'), ('anon','public.tips'), ('authenticated','public.paid_sessions'), ('authenticated','public.tips')) v(role, tbl) LOOP
    PERFORM t.ok(NOT has_table_privilege(r.role, r.tbl, 'MAINTAIN'), format('17: %s has no MAINTAIN on %s', r.role, r.tbl));
  END LOOP;
  PERFORM t.ok(has_table_privilege('service_role', 'public.paid_sessions', 'MAINTAIN') AND has_table_privilege('service_role', 'public.tips', 'MAINTAIN'), '17: service_role keeps MAINTAIN');
END $v17$;
BEGIN; SET LOCAL ROLE anon;
SELECT CASE WHEN t.v17() THEN t.expect('LOCK TABLE public.tips IN ACCESS EXCLUSIVE MODE', true, '17: anon LOCK tips denied (MAINTAIN revoked)') END;
ROLLBACK;

-- 3. service_role unchanged
BEGIN; SET LOCAL ROLE service_role;
SELECT t.expect('TRUNCATE public.paid_sessions', false, 'service_role: TRUNCATE still allowed (server-side maintenance)');
SELECT t.expect($q$SELECT setval('public.paid_sessions_id_seq', (SELECT max(id) FROM public.paid_sessions))$q$, false, 'service_role: setval still allowed');
ROLLBACK;

SELECT t.assert_history_unchanged('after migration');
