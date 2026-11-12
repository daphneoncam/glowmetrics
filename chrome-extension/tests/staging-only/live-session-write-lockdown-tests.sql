-- STAGING / LOCAL ONLY. Never run against production.
--
-- Security + semantics tests for
--   glowmetrics_fresh/supabase/migrations/20261014b_lock_live_session_writes.sql
--
-- Self-contained: creates two throwaway users inside ONE transaction and
-- ends with ROLLBACK, so nothing is left behind. Every check RAISEs on
-- failure (aborting the run); a clean run ends with the NOTICE
-- 'LIVE SESSION LOCKDOWN TESTS: ALL PASSED'.
--
-- Must be run as the database owner role (postgres) so it can impersonate
-- the browser roles (authenticated / anon) exactly the way PostgREST does:
-- SET ROLE + request.jwt.claims.
--
-- Note: now() is fixed for the whole transaction, so time-based semantics
-- are exercised by backdating timestamps as the owner role first.

BEGIN;

CREATE SCHEMA lockdown_test;

CREATE TABLE lockdown_test.ids (k text PRIMARY KEY, v uuid);
INSERT INTO lockdown_test.ids VALUES
  ('a', '00000000-0000-4000-a000-00000000000a'),
  ('b', '00000000-0000-4000-a000-00000000000b'),
  ('f', '00000000-0000-4000-a000-00000000000f');

CREATE TABLE lockdown_test.passes (n integer NOT NULL);
INSERT INTO lockdown_test.passes VALUES (0);

CREATE FUNCTION lockdown_test.id(p text) RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT v FROM lockdown_test.ids WHERE k = p $$;

-- Impersonate a browser caller. p_uid NULL = anon.
CREATE FUNCTION lockdown_test.act_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_uid IS NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
END $$;

-- Run p_sql as p_uid and require it to be refused for lack of privilege.
CREATE FUNCTION lockdown_test.expect_denied(p_label text, p_uid uuid, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_rows bigint;
BEGIN
  BEGIN
    PERFORM lockdown_test.act_as(p_uid);
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE EXCEPTION 'FAIL [%]: browser write was allowed (% row(s)): %', p_label, v_rows, p_sql
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- refused, as required. Subtransaction rollback restores role/claims.
  END;
  UPDATE lockdown_test.passes SET n = n + 1;
  RAISE NOTICE 'ok  denied: %', p_label;
END $$;

CREATE FUNCTION lockdown_test.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL [%]', p_label;
  END IF;
  UPDATE lockdown_test.passes SET n = n + 1;
  RAISE NOTICE 'ok  %', p_label;
END $$;

GRANT USAGE ON SCHEMA lockdown_test TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA lockdown_test TO authenticated, anon;
GRANT SELECT ON lockdown_test.ids TO authenticated, anon;
GRANT SELECT, UPDATE ON lockdown_test.passes TO authenticated, anon;

-- ── Fixtures: users A and B on Pro (the start gate is unchanged), F on Free ──
INSERT INTO auth.users (id, email, aud, role)
SELECT v, k || '-lockdown-test@camcash.invalid', 'authenticated', 'authenticated'
FROM lockdown_test.ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id) SELECT v FROM lockdown_test.ids ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET plan = 'pro', plan_expires_at = NULL WHERE id IN (lockdown_test.id('a'), lockdown_test.id('b'));
UPDATE public.profiles SET plan = 'free', plan_expires_at = NULL WHERE id = lockdown_test.id('f');

-- ═════════════════════════════════════════════════════════════════════════
-- 0. Function security attributes
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.prosecdef, p.proconfig, p.proacl, p.prosrc,
           coalesce(p.proargnames, '{}') AS argnames
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'start_live_session','pause_live_session','resume_live_session','stop_live_session',
      'resolve_live_session','sweep_stale_live_session','send_website_heartbeat',
      'send_extension_heartbeat','clear_live_session_tips','acknowledge_live_session',
      'set_live_session_coaching_strategy','set_live_session_goal_tokens',
      '_finalize_live_session_metrics')
  LOOP
    PERFORM lockdown_test.check(r.prosecdef, r.sig || ' is SECURITY DEFINER');
    PERFORM lockdown_test.check(r.proconfig @> ARRAY['search_path=public, pg_temp'], r.sig || ' pins search_path');
    -- A NULL ACL means the default grant: EXECUTE to PUBLIC.
    PERFORM lockdown_test.check(
      r.proacl IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'),
      r.sig || ' has no PUBLIC EXECUTE');
    PERFORM lockdown_test.check(NOT has_function_privilege('anon', r.sig::oid, 'EXECUTE'), r.sig || ' not executable by anon');
    PERFORM lockdown_test.check(
      NOT EXISTS (SELECT 1 FROM unnest(r.argnames) a WHERE a ILIKE '%user%' OR a ILIKE '%uid%'),
      r.sig || ' takes no caller-supplied user id');
    IF r.proname = '_finalize_live_session_metrics' THEN
      -- Internal helper: takes a session id, so it must not be callable by end users.
      PERFORM lockdown_test.check(NOT has_function_privilege('authenticated', r.sig::oid, 'EXECUTE'),
        r.sig || ' (internal) not executable by authenticated');
    ELSE
      PERFORM lockdown_test.check(has_function_privilege('authenticated', r.sig::oid, 'EXECUTE'),
        r.sig || ' executable by authenticated');
      PERFORM lockdown_test.check(r.prosrc LIKE '%auth.uid()%', r.sig || ' derives caller from auth.uid()');
      PERFORM lockdown_test.check(
        r.prosrc ~* 'user_id\s*=\s*(v_uid|auth\.uid\(\))',
        r.sig || ' filters rows by the caller''s user_id');
    END IF;
  END LOOP;
  PERFORM lockdown_test.check(
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef AND p.proname IN (
        'start_live_session','pause_live_session','resume_live_session','stop_live_session',
        'resolve_live_session','sweep_stale_live_session','send_website_heartbeat',
        'send_extension_heartbeat','clear_live_session_tips','acknowledge_live_session',
        'set_live_session_coaching_strategy','set_live_session_goal_tokens',
        '_finalize_live_session_metrics')) = 13,
    'all 13 lifecycle functions present and SECURITY DEFINER');
  PERFORM lockdown_test.check(
    NOT has_function_privilege('authenticated', 'public._finalize_live_session_metrics(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._finalize_live_session_metrics(uuid)', 'EXECUTE'),
    '_finalize_live_session_metrics not executable by browser roles');
  PERFORM lockdown_test.check(
    NOT has_function_privilege('anon', 'public.start_live_session(text)', 'EXECUTE'),
    'anon cannot execute start_live_session');

  -- The DEFINER functions search `public, pg_temp`: no untrusted role may be
  -- able to create objects in `public` that could shadow the intended ones.
  PERFORM lockdown_test.check(
    NOT has_schema_privilege('anon', 'public', 'CREATE')
    AND NOT has_schema_privilege('authenticated', 'public', 'CREATE')
    AND NOT EXISTS (SELECT 1 FROM pg_namespace ns, aclexplode(ns.nspacl) x
                    WHERE ns.nspname = 'public' AND x.grantee = 0 AND x.privilege_type = 'CREATE'),
    'PUBLIC / anon / authenticated cannot CREATE in schema public');
  PERFORM lockdown_test.check(
    NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                  AND pg_get_userbyid(c.relowner) IN ('anon', 'authenticated'))
    AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND pg_get_userbyid(p.proowner) IN ('anon', 'authenticated')),
    'browser roles own no objects in schema public');
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Owner lifecycle through the RPCs (production semantics preserved)
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  a uuid := lockdown_test.id('a');
  s public.live_sessions;
  v_id uuid;
BEGIN
  PERFORM lockdown_test.act_as(a);
  s := public.start_live_session('Chaturbate');
  RESET ROLE;
  v_id := s.id;
  PERFORM lockdown_test.check(s.status = 'starting' AND s.live_substate IS NULL AND s.user_id = a, 'start -> starting');

  -- start is idempotent while a session is running
  PERFORM lockdown_test.act_as(a);
  s := public.start_live_session('Chaturbate');
  RESET ROLE;
  PERFORM lockdown_test.check(s.id = v_id, 'repeated start returns the same running session');

  PERFORM lockdown_test.act_as(a);
  s := public.send_website_heartbeat();
  RESET ROLE;
  PERFORM lockdown_test.check(s.status = 'live' AND s.live_substate = 'active', 'website heartbeat: starting -> live/active');

  PERFORM lockdown_test.act_as(a);
  s := public.send_extension_heartbeat('Chaturbate', true);
  RESET ROLE;
  PERFORM lockdown_test.check(s.extension_platform = 'Chaturbate' AND s.broadcaster_page_detected, 'extension heartbeat recorded');

  PERFORM lockdown_test.act_as(a);
  s := public.set_live_session_coaching_strategy('whale');
  RESET ROLE;
  PERFORM lockdown_test.check(s.coaching_strategy = 'whale', 'set coaching strategy');

  PERFORM lockdown_test.act_as(a);
  s := public.set_live_session_goal_tokens(500);
  RESET ROLE;
  PERFORM lockdown_test.check(s.coaching_goal_tokens = 500, 'set goal tokens');

  PERFORM lockdown_test.act_as(a);
  s := public.clear_live_session_tips();
  RESET ROLE;
  PERFORM lockdown_test.check(s.tips_cleared_at IS NOT NULL, 'clear session tips');

  -- Pause / resume: paused time accrues exactly (paused 300 s ago).
  PERFORM lockdown_test.act_as(a);
  s := public.pause_live_session();
  RESET ROLE;
  PERFORM lockdown_test.check(s.live_substate = 'paused' AND s.paused_at IS NOT NULL, 'pause -> paused');
  PERFORM lockdown_test.check(
    (SELECT count(*) FROM public.live_session_pauses WHERE session_id = v_id AND resumed_at IS NULL) = 1,
    'pause opens one live_session_pauses row');

  PERFORM lockdown_test.act_as(a);
  s := public.pause_live_session();
  RESET ROLE;
  PERFORM lockdown_test.check(s.id IS NULL, 'repeated pause is a no-op');

  UPDATE public.live_sessions SET paused_at = now() - interval '300 seconds' WHERE id = v_id;
  UPDATE public.live_session_pauses SET paused_at = now() - interval '300 seconds' WHERE session_id = v_id;

  PERFORM lockdown_test.act_as(a);
  s := public.resume_live_session();
  RESET ROLE;
  PERFORM lockdown_test.check(s.live_substate = 'active' AND s.paused_at IS NULL AND s.total_paused_seconds = 300,
    'resume -> active, total_paused_seconds += 300');
  PERFORM lockdown_test.check(
    (SELECT pause_duration_seconds FROM public.live_session_pauses WHERE session_id = v_id) = 300,
    'resume closes the pause row with 300 s');

  -- Stop while paused: the open pause is closed at ended_at and counted.
  PERFORM lockdown_test.act_as(a);
  s := public.pause_live_session();
  RESET ROLE;
  UPDATE public.live_sessions
    SET paused_at = now() - interval '60 seconds', started_at = now() - interval '3600 seconds'
    WHERE id = v_id;
  UPDATE public.live_session_pauses SET paused_at = now() - interval '60 seconds'
    WHERE session_id = v_id AND resumed_at IS NULL;

  PERFORM lockdown_test.act_as(a);
  s := public.stop_live_session();
  RESET ROLE;
  PERFORM lockdown_test.check(s.status = 'ended' AND s.session_resolution_type = 'normal_stop' AND s.finalized_at IS NOT NULL,
    'stop -> ended, normal_stop, finalized');
  PERFORM lockdown_test.check(s.total_paused_seconds = 360 AND s.final_duration_seconds = 3600 - 360,
    'stop while paused: paused 360 s, final_duration_seconds = 3240');
  PERFORM lockdown_test.check(
    (SELECT count(*) FROM public.live_session_pauses WHERE session_id = v_id AND resumed_at IS NULL) = 0,
    'stop closes the open pause row');

  -- Repeated stop: nothing to stop.
  PERFORM lockdown_test.act_as(a);
  s := public.stop_live_session();
  RESET ROLE;
  PERFORM lockdown_test.check(s.id IS NULL, 'repeated stop is a no-op');

  PERFORM lockdown_test.act_as(a);
  s := public.acknowledge_live_session(v_id);
  RESET ROLE;
  PERFORM lockdown_test.check(s.dashboard_seen_at IS NOT NULL, 'acknowledge finalized session');

  INSERT INTO lockdown_test.ids VALUES ('a_ended', v_id);
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Browser cannot write live_sessions directly (own rows)
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  a uuid := lockdown_test.id('a');
  e uuid := lockdown_test.id('a_ended');
  s public.live_sessions;
  col text;
BEGIN
  -- a running session for A as well
  PERFORM lockdown_test.act_as(a);
  s := public.start_live_session('Chaturbate');
  RESET ROLE;
  INSERT INTO lockdown_test.ids VALUES ('a_live', s.id);

  FOREACH col IN ARRAY ARRAY[
    'started_at = now() - interval ''1 day''',
    'ended_at = now()',
    'status = ''ended''',
    'live_substate = ''paused''',
    'stream_platform = ''Stripchat''',
    'paused_at = now()',
    'total_paused_seconds = 99999',
    'last_heartbeat_at = now()',
    'is_active = false',
    'final_total_usd = 99999',
    'final_duration_seconds = 99999',
    'final_usd_per_hour = 99999',
    'finalized_at = now()',
    'session_resolution_type = ''normal_stop''',
    'coaching_strategy = ''aggressive''',
    'user_id = ''' || lockdown_test.id('b') || ''''
  ] LOOP
    PERFORM lockdown_test.expect_denied('UPDATE own live session: ' || col, a,
      format('UPDATE public.live_sessions SET %s WHERE id = %L', col, s.id));
    PERFORM lockdown_test.expect_denied('UPDATE own finalized session: ' || col, a,
      format('UPDATE public.live_sessions SET %s WHERE id = %L', col, e));
  END LOOP;

  PERFORM lockdown_test.expect_denied('DELETE own live session', a,
    format('DELETE FROM public.live_sessions WHERE id = %L', s.id));
  PERFORM lockdown_test.expect_denied('DELETE own finalized session', a,
    format('DELETE FROM public.live_sessions WHERE id = %L', e));
  PERFORM lockdown_test.expect_denied('INSERT live session directly', a,
    format('INSERT INTO public.live_sessions (user_id, status, started_at, stream_platform) VALUES (%L, ''ended'', now(), ''Chaturbate'')', a));
  PERFORM lockdown_test.expect_denied('TRUNCATE live_sessions', a, 'TRUNCATE public.live_sessions');
  PERFORM lockdown_test.expect_denied('anon UPDATE live_sessions', NULL,
    format('UPDATE public.live_sessions SET final_total_usd = 1 WHERE id = %L', e));
  PERFORM lockdown_test.expect_denied('anon DELETE live_sessions', NULL,
    format('DELETE FROM public.live_sessions WHERE id = %L', e));

  PERFORM lockdown_test.check(
    (SELECT final_total_usd IS DISTINCT FROM 99999 AND final_duration_seconds = 3240
       FROM public.live_sessions WHERE id = e),
    'finalized earnings/duration unchanged after attempted edits');

  -- Reading own sessions still works (API routes, post-show, Realtime).
  PERFORM lockdown_test.act_as(a);
  PERFORM lockdown_test.check((SELECT count(*) FROM public.live_sessions WHERE user_id = a) = 2, 'owner can SELECT own sessions');
  RESET ROLE;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Browser cannot manipulate pause rows
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  a uuid := lockdown_test.id('a');
  e uuid := lockdown_test.id('a_ended');
  l uuid := lockdown_test.id('a_live');
BEGIN
  PERFORM lockdown_test.expect_denied('INSERT pause row', a,
    format('INSERT INTO public.live_session_pauses (session_id, user_id, paused_at) VALUES (%L, %L, now())', l, a));
  PERFORM lockdown_test.expect_denied('UPDATE pause duration', a,
    format('UPDATE public.live_session_pauses SET pause_duration_seconds = 99999 WHERE session_id = %L', e));
  PERFORM lockdown_test.expect_denied('UPDATE pause timestamps', a,
    format('UPDATE public.live_session_pauses SET paused_at = now() - interval ''1 day'', resumed_at = now() WHERE session_id = %L', e));
  PERFORM lockdown_test.expect_denied('DELETE pause row', a,
    format('DELETE FROM public.live_session_pauses WHERE session_id = %L', e));
  PERFORM lockdown_test.expect_denied('anon INSERT pause row', NULL,
    format('INSERT INTO public.live_session_pauses (session_id, user_id, paused_at) VALUES (%L, %L, now())', l, a));

  PERFORM lockdown_test.check(
    (SELECT sum(pause_duration_seconds) FROM public.live_session_pauses WHERE session_id = e) = 360,
    'pause history unchanged after attempted edits');

  PERFORM lockdown_test.act_as(a);
  PERFORM lockdown_test.check((SELECT count(*) FROM public.live_session_pauses WHERE session_id = e) = 2, 'owner can SELECT own pause rows');
  RESET ROLE;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. One user can never touch another user's session
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  b uuid := lockdown_test.id('b');
  e uuid := lockdown_test.id('a_ended');
  l uuid := lockdown_test.id('a_live');
  s public.live_sessions;
  v_before text;
BEGIN
  SELECT md5(row_to_json(x)::text) INTO v_before FROM public.live_sessions x WHERE id = l;

  PERFORM lockdown_test.expect_denied('B UPDATE A''s session', b,
    format('UPDATE public.live_sessions SET status = ''ended'' WHERE id = %L', l));
  PERFORM lockdown_test.expect_denied('B DELETE A''s session', b,
    format('DELETE FROM public.live_sessions WHERE id = %L', e));
  PERFORM lockdown_test.expect_denied('B calls _finalize on A''s session', b,
    format('SELECT public._finalize_live_session_metrics(%L)', e));

  -- B's own lifecycle RPCs act on B only (B has no running session).
  PERFORM lockdown_test.act_as(b);
  s := public.pause_live_session();
  PERFORM lockdown_test.check(s.id IS NULL, 'B pause does not reach A');
  s := public.stop_live_session();
  PERFORM lockdown_test.check(s.id IS NULL, 'B stop does not reach A');
  s := public.acknowledge_live_session(e);
  PERFORM lockdown_test.check(s.id IS NULL, 'B cannot acknowledge A''s session');
  s := public.resume_live_session();
  PERFORM lockdown_test.check(s.id IS NULL, 'B resume does not reach A');
  s := public.set_live_session_coaching_strategy('aggressive');
  PERFORM lockdown_test.check(s.id IS NULL, 'B set strategy does not reach A');
  s := public.set_live_session_goal_tokens(1);
  PERFORM lockdown_test.check(s.id IS NULL, 'B set goal does not reach A');
  s := public.clear_live_session_tips();
  PERFORM lockdown_test.check(s.id IS NULL, 'B clear tips does not reach A');
  s := public.send_website_heartbeat();
  PERFORM lockdown_test.check(s.id IS NULL, 'B website heartbeat does not reach A');
  s := public.send_extension_heartbeat('Stripchat', false);
  PERFORM lockdown_test.check(s.id IS NULL, 'B extension heartbeat does not reach A');
  s := public.resolve_live_session('mark_invalid', NULL);
  PERFORM lockdown_test.check(s.id IS NULL, 'B resolve does not reach A');
  PERFORM public.sweep_stale_live_session();
  PERFORM lockdown_test.check((SELECT count(*) FROM public.live_sessions WHERE id IN (e, l)) = 0, 'B cannot SELECT A''s sessions');
  RESET ROLE;

  PERFORM lockdown_test.check(
    (SELECT md5(row_to_json(x)::text) FROM public.live_sessions x WHERE id = l) = v_before,
    'A''s running session unchanged by B');
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Stale-session behavior unchanged (production 10 / 20 minute rule)
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  a uuid := lockdown_test.id('a');
  l uuid := lockdown_test.id('a_live');
  s public.live_sessions;
  v_hb timestamptz;
BEGIN
  -- bring A's running session to live/active, then go silent for 11 minutes
  PERFORM lockdown_test.act_as(a);
  s := public.send_website_heartbeat();
  RESET ROLE;
  v_hb := now() - interval '11 minutes';
  UPDATE public.live_sessions SET last_heartbeat_at = v_hb, started_at = now() - interval '40 minutes' WHERE id = l;

  PERFORM lockdown_test.act_as(a);
  PERFORM public.sweep_stale_live_session();
  RESET ROLE;
  SELECT * INTO s FROM public.live_sessions WHERE id = l;
  PERFORM lockdown_test.check(s.status = 'inactive_warning' AND s.warning_started_at = v_hb,
    'sweep: live + 10 min silent -> inactive_warning at last heartbeat');

  -- Still Live: back to live, uncertainty window counted as paused (production rule).
  UPDATE public.live_sessions SET warning_started_at = now() - interval '120 seconds' WHERE id = l;
  PERFORM lockdown_test.act_as(a);
  s := public.resolve_live_session('still_live', NULL);
  RESET ROLE;
  PERFORM lockdown_test.check(s.status = 'live' AND s.total_paused_seconds = 120,
    'resolve still_live -> live, +120 s uncertainty');

  -- 21 minutes silent with no tips -> auto-ended at last heartbeat, finalized.
  v_hb := now() - interval '21 minutes';
  UPDATE public.live_sessions SET status = 'inactive_warning', warning_started_at = v_hb, last_heartbeat_at = v_hb WHERE id = l;
  PERFORM lockdown_test.act_as(a);
  PERFORM public.sweep_stale_live_session();
  RESET ROLE;
  SELECT * INTO s FROM public.live_sessions WHERE id = l;
  PERFORM lockdown_test.check(
    s.status = 'ended' AND s.session_resolution_type = 'auto_ended_inactivity'
      AND s.ended_at = v_hb AND s.finalized_at IS NOT NULL,
    'sweep: inactive_warning + 20 min silent -> auto_ended_inactivity at last heartbeat, finalized');

  -- Global pg_cron sweep (runs as owner) still works.
  PERFORM lockdown_test.act_as(a);
  s := public.start_live_session('Chaturbate');
  s := public.send_website_heartbeat();
  RESET ROLE;
  UPDATE public.live_sessions SET last_heartbeat_at = now() - interval '11 minutes' WHERE id = s.id;
  PERFORM public.sweep_all_stale_live_sessions();
  PERFORM lockdown_test.check(
    (SELECT status FROM public.live_sessions WHERE id = s.id) = 'inactive_warning',
    'global cron sweep: live + 10 min silent -> inactive_warning');

  -- resolve 'ended' as the owner finalizes
  PERFORM lockdown_test.act_as(a);
  s := public.resolve_live_session('end_at_last_heartbeat', NULL);
  RESET ROLE;
  PERFORM lockdown_test.check(s.status = 'ended' AND s.finalized_at IS NOT NULL, 'resolve end_at_last_heartbeat -> ended, finalized');
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Pro start gate unchanged (Free still blocked — loosened in a later PR)
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  s public.live_sessions;
BEGIN
  BEGIN
    PERFORM lockdown_test.act_as(lockdown_test.id('f'));
    s := public.start_live_session('Chaturbate');
    RAISE EXCEPTION 'FAIL [free user start]: Free user was able to start Live Mode';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'LIVE_MODE_REQUIRES_PRO%' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'ok  Free user still gets LIVE_MODE_REQUIRES_PRO';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'LIVE SESSION LOCKDOWN TESTS: ALL PASSED (% checks)', (SELECT n FROM lockdown_test.passes);
END $$;

ROLLBACK;
