-- STAGING ONLY. Never run against production.
--
-- Single-DO-block form of live-session-write-lockdown-tests.sql (sections 1–6),
-- for running through the Supabase MCP execute_sql tool, which holds any
-- request containing destructive keywords (DROP / TRUNCATE / row removal) for
-- an interactive confirmation and stalls on the multi-object helper schema.
-- Row-removal / table-clear denials are therefore asserted through the
-- catalog (browser roles hold only SELECT) instead of attempted; the full
-- psql suite attempts them directly.
--
-- Everything runs inside one DO block that ends by RAISING its result, so
-- every fixture and every lifecycle call is rolled back.
DO $$
DECLARE
  a  uuid := '00000000-0000-4000-a000-00000000000a';
  b  uuid := '00000000-0000-4000-a000-00000000000b';
  f  uuid := '00000000-0000-4000-a000-00000000000f';
  s  public.live_sessions;
  v_ended uuid;
  v_live  uuid;
  v_hb timestamptz;
  v_before text;
  n  int := 0;
  stmt text;
  who uuid;
  v_rows bigint;
  ok boolean;
BEGIN
  -- fixtures
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (a, 'a-lockdown-test@camcash.invalid', 'authenticated', 'authenticated'),
    (b, 'b-lockdown-test@camcash.invalid', 'authenticated', 'authenticated'),
    (f, 'f-lockdown-test@camcash.invalid', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id) VALUES (a), (b), (f) ON CONFLICT (id) DO NOTHING;
  UPDATE public.profiles SET plan = 'pro',  plan_expires_at = NULL WHERE id IN (a, b);
  UPDATE public.profiles SET plan = 'free', plan_expires_at = NULL WHERE id = f;

  -- ── 1. owner lifecycle (production semantics) ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  s := public.start_live_session('Chaturbate');
  IF NOT (s.status = 'starting' AND s.live_substate IS NULL AND s.user_id = a) THEN RAISE EXCEPTION 'FAIL start'; END IF; n := n + 1;
  v_ended := s.id;
  s := public.start_live_session('Chaturbate');
  IF s.id <> v_ended THEN RAISE EXCEPTION 'FAIL repeated start'; END IF; n := n + 1;
  s := public.send_website_heartbeat();
  IF NOT (s.status = 'live' AND s.live_substate = 'active') THEN RAISE EXCEPTION 'FAIL website heartbeat'; END IF; n := n + 1;
  s := public.send_extension_heartbeat('Chaturbate', true);
  IF NOT (s.extension_platform = 'Chaturbate' AND s.broadcaster_page_detected) THEN RAISE EXCEPTION 'FAIL extension heartbeat'; END IF; n := n + 1;
  s := public.set_live_session_coaching_strategy('whale');
  IF s.coaching_strategy <> 'whale' THEN RAISE EXCEPTION 'FAIL strategy'; END IF; n := n + 1;
  s := public.set_live_session_goal_tokens(500);
  IF s.coaching_goal_tokens <> 500 THEN RAISE EXCEPTION 'FAIL goal'; END IF; n := n + 1;
  s := public.clear_live_session_tips();
  IF s.tips_cleared_at IS NULL THEN RAISE EXCEPTION 'FAIL clear tips'; END IF; n := n + 1;
  s := public.pause_live_session();
  IF NOT (s.live_substate = 'paused' AND s.paused_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL pause'; END IF; n := n + 1;
  s := public.pause_live_session();
  IF s.id IS NOT NULL THEN RAISE EXCEPTION 'FAIL repeated pause'; END IF; n := n + 1;
  RESET ROLE;
  IF (SELECT count(*) FROM public.live_session_pauses WHERE session_id = v_ended AND resumed_at IS NULL) <> 1 THEN RAISE EXCEPTION 'FAIL pause row'; END IF; n := n + 1;
  UPDATE public.live_sessions SET paused_at = now() - interval '300 seconds' WHERE id = v_ended;
  UPDATE public.live_session_pauses SET paused_at = now() - interval '300 seconds' WHERE session_id = v_ended;
  SET LOCAL ROLE authenticated;
  s := public.resume_live_session();
  IF NOT (s.live_substate = 'active' AND s.paused_at IS NULL AND s.total_paused_seconds = 300) THEN RAISE EXCEPTION 'FAIL resume +300'; END IF; n := n + 1;
  s := public.pause_live_session();
  RESET ROLE;
  IF (SELECT pause_duration_seconds FROM public.live_session_pauses WHERE session_id = v_ended AND resumed_at IS NOT NULL) <> 300 THEN RAISE EXCEPTION 'FAIL pause row 300'; END IF; n := n + 1;
  UPDATE public.live_sessions SET paused_at = now() - interval '60 seconds', started_at = now() - interval '3600 seconds' WHERE id = v_ended;
  UPDATE public.live_session_pauses SET paused_at = now() - interval '60 seconds' WHERE session_id = v_ended AND resumed_at IS NULL;
  SET LOCAL ROLE authenticated;
  s := public.stop_live_session();
  IF NOT (s.status = 'ended' AND s.session_resolution_type = 'normal_stop' AND s.finalized_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL stop'; END IF; n := n + 1;
  IF NOT (s.total_paused_seconds = 360 AND s.final_duration_seconds = 3240) THEN RAISE EXCEPTION 'FAIL stop while paused 360/3240'; END IF; n := n + 1;
  s := public.stop_live_session();
  IF s.id IS NOT NULL THEN RAISE EXCEPTION 'FAIL repeated stop'; END IF; n := n + 1;
  s := public.acknowledge_live_session(v_ended);
  IF s.dashboard_seen_at IS NULL THEN RAISE EXCEPTION 'FAIL acknowledge'; END IF; n := n + 1;
  s := public.start_live_session('Chaturbate');
  v_live := s.id;
  RESET ROLE;
  IF (SELECT count(*) FROM public.live_session_pauses WHERE session_id = v_ended AND resumed_at IS NULL) <> 0 THEN RAISE EXCEPTION 'FAIL stop closes pause'; END IF; n := n + 1;

  -- ── 2–4. direct browser writes are refused ────────────────────────────
  FOR who, stmt IN
    SELECT x.who, x.stmt FROM (VALUES
      (a, format('UPDATE public.live_sessions SET started_at = now() - interval ''1 day'' WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET ended_at = now() WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET status = ''ended'' WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET live_substate = ''paused'' WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET stream_platform = ''Stripchat'' WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET paused_at = now() WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET total_paused_seconds = 99999 WHERE id = %L', v_live)),
      (a, format('UPDATE public.live_sessions SET user_id = %L WHERE id = %L', b, v_live)),
      (a, format('UPDATE public.live_sessions SET final_total_usd = 99999 WHERE id = %L', v_ended)),
      (a, format('UPDATE public.live_sessions SET final_duration_seconds = 99999 WHERE id = %L', v_ended)),
      (a, format('UPDATE public.live_sessions SET final_usd_per_hour = 99999 WHERE id = %L', v_ended)),
      (a, format('UPDATE public.live_sessions SET started_at = now() - interval ''1 day'' WHERE id = %L', v_ended)),
      (a, format('UPDATE public.live_sessions SET finalized_at = now() WHERE id = %L', v_ended)),
      (a, format('INSERT INTO public.live_sessions (user_id, status, started_at, stream_platform) VALUES (%L, ''ended'', now(), ''Chaturbate'')', a)),
      (a, format('INSERT INTO public.live_session_pauses (session_id, user_id, paused_at) VALUES (%L, %L, now())', v_live, a)),
      (a, format('UPDATE public.live_session_pauses SET pause_duration_seconds = 99999 WHERE session_id = %L', v_ended)),
      (a, format('UPDATE public.live_session_pauses SET paused_at = now() - interval ''1 day'', resumed_at = now() WHERE session_id = %L', v_ended)),
      (b, format('UPDATE public.live_sessions SET status = ''ended'' WHERE id = %L', v_live)),
      (b, format('SELECT public._finalize_live_session_metrics(%L)', v_ended)),
      (NULL, format('UPDATE public.live_sessions SET final_total_usd = 1 WHERE id = %L', v_ended)),
      (NULL, format('INSERT INTO public.live_session_pauses (session_id, user_id, paused_at) VALUES (%L, %L, now())', v_live, a))
    ) AS x(who, stmt)
  LOOP
    BEGIN
      IF who IS NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        SET LOCAL ROLE anon;
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
      END IF;
      EXECUTE stmt;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RAISE EXCEPTION 'FAIL browser write allowed (% rows): %', v_rows, stmt USING ERRCODE = 'P0001';
    EXCEPTION WHEN insufficient_privilege THEN
      n := n + 1;
    END;
    RESET ROLE;
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'public' AND g.table_name IN ('live_sessions','live_session_pauses')
        AND g.grantee IN ('anon','authenticated') AND g.privilege_type <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL browser roles hold more than SELECT';
  END IF; n := n + 1;
  IF EXISTS (SELECT 1 FROM information_schema.column_privileges c
      WHERE c.table_schema = 'public' AND c.table_name IN ('live_sessions','live_session_pauses')
        AND c.grantee IN ('anon','authenticated') AND c.privilege_type <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL browser roles hold column write privileges';
  END IF; n := n + 1;
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace ns, aclexplode(ns.nspacl) x
                WHERE ns.nspname = 'public' AND x.grantee = 0 AND x.privilege_type = 'CREATE') THEN
    RAISE EXCEPTION 'FAIL PUBLIC/anon/authenticated can CREATE in schema public';
  END IF; n := n + 1;
  IF (SELECT final_total_usd = 99999 OR final_duration_seconds <> 3240 FROM public.live_sessions WHERE id = v_ended) THEN
    RAISE EXCEPTION 'FAIL finalized earnings changed';
  END IF; n := n + 1;
  IF (SELECT sum(pause_duration_seconds) FROM public.live_session_pauses WHERE session_id = v_ended) <> 360 THEN
    RAISE EXCEPTION 'FAIL pause history changed';
  END IF; n := n + 1;

  -- owner can still read; B cannot read A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.live_sessions WHERE user_id = a) <> 2 THEN RAISE EXCEPTION 'FAIL owner read sessions'; END IF; n := n + 1;
  IF (SELECT count(*) FROM public.live_session_pauses WHERE session_id = v_ended) <> 2 THEN RAISE EXCEPTION 'FAIL owner read pauses'; END IF; n := n + 1;
  RESET ROLE;

  -- B's RPCs never reach A
  SELECT md5(row_to_json(x)::text) INTO v_before FROM public.live_sessions x WHERE id = v_live;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF (public.pause_live_session()).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B pause'; END IF; n := n + 1;
  IF (public.resume_live_session()).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B resume'; END IF; n := n + 1;
  IF (public.stop_live_session()).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B stop'; END IF; n := n + 1;
  IF (public.acknowledge_live_session(v_ended)).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B acknowledge'; END IF; n := n + 1;
  IF (public.set_live_session_coaching_strategy('aggressive')).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B strategy'; END IF; n := n + 1;
  IF (public.set_live_session_goal_tokens(1)).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B goal'; END IF; n := n + 1;
  IF (public.clear_live_session_tips()).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B clear'; END IF; n := n + 1;
  IF (public.send_website_heartbeat()).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B website hb'; END IF; n := n + 1;
  IF (public.send_extension_heartbeat('Stripchat', false)).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B extension hb'; END IF; n := n + 1;
  IF (public.resolve_live_session('mark_invalid', NULL)).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL B resolve'; END IF; n := n + 1;
  PERFORM public.sweep_stale_live_session();
  IF (SELECT count(*) FROM public.live_sessions WHERE id IN (v_ended, v_live)) <> 0 THEN RAISE EXCEPTION 'FAIL B can read A'; END IF; n := n + 1;
  RESET ROLE;
  IF (SELECT md5(row_to_json(x)::text) FROM public.live_sessions x WHERE id = v_live) <> v_before THEN RAISE EXCEPTION 'FAIL A changed by B'; END IF; n := n + 1;

  -- ── 5. stale-session behavior unchanged ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  s := public.send_website_heartbeat();
  RESET ROLE;
  v_hb := now() - interval '11 minutes';
  UPDATE public.live_sessions SET last_heartbeat_at = v_hb, started_at = now() - interval '40 minutes' WHERE id = v_live;
  SET LOCAL ROLE authenticated;
  PERFORM public.sweep_stale_live_session();
  RESET ROLE;
  SELECT * INTO s FROM public.live_sessions WHERE id = v_live;
  IF NOT (s.status = 'inactive_warning' AND s.warning_started_at = v_hb) THEN RAISE EXCEPTION 'FAIL sweep 10 min'; END IF; n := n + 1;
  UPDATE public.live_sessions SET warning_started_at = now() - interval '120 seconds' WHERE id = v_live;
  SET LOCAL ROLE authenticated;
  s := public.resolve_live_session('still_live', NULL);
  RESET ROLE;
  IF NOT (s.status = 'live' AND s.total_paused_seconds = 120) THEN RAISE EXCEPTION 'FAIL still_live +120'; END IF; n := n + 1;
  v_hb := now() - interval '21 minutes';
  UPDATE public.live_sessions SET status = 'inactive_warning', warning_started_at = v_hb, last_heartbeat_at = v_hb WHERE id = v_live;
  SET LOCAL ROLE authenticated;
  PERFORM public.sweep_stale_live_session();
  RESET ROLE;
  SELECT * INTO s FROM public.live_sessions WHERE id = v_live;
  IF NOT (s.status = 'ended' AND s.session_resolution_type = 'auto_ended_inactivity' AND s.ended_at = v_hb AND s.finalized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL sweep 20 min auto-end';
  END IF; n := n + 1;
  SET LOCAL ROLE authenticated;
  s := public.start_live_session('Chaturbate');
  s := public.send_website_heartbeat();
  RESET ROLE;
  UPDATE public.live_sessions SET last_heartbeat_at = now() - interval '11 minutes' WHERE id = s.id;
  PERFORM public.sweep_all_stale_live_sessions();
  IF (SELECT status FROM public.live_sessions WHERE id = s.id) <> 'inactive_warning' THEN RAISE EXCEPTION 'FAIL cron sweep'; END IF; n := n + 1;
  SET LOCAL ROLE authenticated;
  s := public.resolve_live_session('end_at_last_heartbeat', NULL);
  RESET ROLE;
  IF NOT (s.status = 'ended' AND s.finalized_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL resolve end'; END IF; n := n + 1;

  -- ── 6. Pro start gate unchanged ───────────────────────────────────────
  ok := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    s := public.start_live_session('Chaturbate');
  EXCEPTION WHEN raise_exception THEN
    ok := SQLERRM LIKE 'LIVE_MODE_REQUIRES_PRO%';
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL Free user not blocked with LIVE_MODE_REQUIRES_PRO'; END IF; n := n + 1;

  RAISE EXCEPTION 'STAGING RESULT (rolled back): ALL PASSED (% checks)', n;
END $$;
