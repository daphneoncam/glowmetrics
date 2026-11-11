\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; RAISE NOTICE 'pass: %', msg; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS
$$ BEGIN EXECUTE q; RETURN 'NO ERROR'; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.sid() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM live_sessions ORDER BY started_at DESC LIMIT 1 $$;
CREATE FUNCTION pg_temp.tip(ago interval) RETURNS void LANGUAGE sql AS
$$ INSERT INTO live_tips (user_id, platform, username, usd, tokens, live_session_id, received_at)
   SELECT user_id, 'bongacams', 'fan', 1, 40, id, now() - ago FROM live_sessions ORDER BY started_at DESC LIMIT 1 $$;

INSERT INTO profiles (id, plan) VALUES
  ('00000000-0000-0000-0000-00000000000f', 'free'),
  ('00000000-0000-0000-0000-00000000000a', 'pro');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000000f', false);

-- ── no real tip yet: clock never runs ──
SELECT start_live_session('BongaCams', NULL);
UPDATE live_sessions SET status='live', live_substate='active', started_at = now() - interval '3 hours', last_heartbeat_at = now();
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL, '3h live, no real tip -> not ended');
SELECT pg_temp.ok(sweep_free_live_active_limits() = 0, 'sweep agrees (no tip)');
SELECT pg_temp.ok((get_live_free_clock())->>'clock_started_at' IS NULL, 'read model: clock not started');
-- a tip from before this stream (not attributed to it) does not start it
INSERT INTO live_tips (user_id, platform, username, usd, tokens, live_session_id, received_at)
  VALUES ('00000000-0000-0000-0000-00000000000f', 'bongacams', 'old', 1, 40, NULL, now());
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL, 'unattributed tip does not start the clock');

-- ── first real tip 30 min ago -> 30 free minutes, still running ──
SELECT pg_temp.tip('30 minutes');
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL, 'first tip 30 min ago -> not ended (was 3h of stream)');
SELECT pg_temp.ok(abs(EXTRACT(EPOCH FROM (now() - ((get_live_free_clock())->>'clock_started_at')::timestamptz)) - 1800) < 2, 'read model: clock started at first tip');
-- later tips don't move the start
SELECT pg_temp.tip('1 minute');
SELECT pg_temp.ok(abs(EXTRACT(EPOCH FROM (now() - ((get_live_free_clock())->>'clock_started_at')::timestamptz)) - 1800) < 2, 'later tip does not reset the clock');

-- ── first tip 36 min ago -> ended at exactly 35 free minutes ──
UPDATE live_tips SET received_at = now() - interval '36 minutes' WHERE username = 'fan' AND received_at < now() - interval '10 minutes';
SELECT pg_temp.ok((enforce_live_active_limit()).session_resolution_type = 'free_active_limit', 'first tip 36 min ago -> ended server-side');
SELECT pg_temp.ok((SELECT abs(EXTRACT(EPOCH FROM (now() - ended_at)) - 60) < 2 FROM live_sessions WHERE status='ended'), 'ended at the instant it hit 35 free minutes (1 min ago)');
DELETE FROM live_tips; DELETE FROM live_session_pauses; DELETE FROM live_sessions;

-- ── pause BEFORE first tip is not subtracted; pause AFTER is ──
SELECT start_live_session('BongaCams', NULL);
UPDATE live_sessions SET status='live', live_substate='active', started_at = now() - interval '2 hours', last_heartbeat_at = now(), total_paused_seconds = 50*60;
INSERT INTO live_session_pauses (session_id, user_id, paused_at, resumed_at, pause_duration_seconds)
  SELECT id, user_id, now() - interval '110 minutes', now() - interval '80 minutes', 1800 FROM live_sessions;   -- before tip
INSERT INTO live_session_pauses (session_id, user_id, paused_at, resumed_at, pause_duration_seconds)
  SELECT id, user_id, now() - interval '30 minutes', now() - interval '10 minutes', 1200 FROM live_sessions;    -- after tip
SELECT pg_temp.tip('50 minutes');  -- 50 min since tip, 20 paused -> 30 free min
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL, '50 min since tip, 20 paused after -> 30 free min, not ended');
SELECT pg_temp.ok(abs(((get_live_free_clock())->>'paused_seconds')::numeric - 1200) < 2, 'only pause after the first tip is counted: ' || ((get_live_free_clock())->>'paused_seconds'));
UPDATE live_tips SET received_at = now() - interval '56 minutes';  -- 36 free min
SELECT pg_temp.ok(sweep_free_live_active_limits() = 1, 'sweep ends it at 36 free min');
DELETE FROM live_tips; DELETE FROM live_session_pauses; DELETE FROM live_sessions;

-- ── pause straddling the first tip: only the part after the tip counts ──
SELECT start_live_session('BongaCams', NULL);
UPDATE live_sessions SET status='live', live_substate='active', started_at = now() - interval '2 hours', last_heartbeat_at = now();
INSERT INTO live_session_pauses (session_id, user_id, paused_at, resumed_at, pause_duration_seconds)
  SELECT id, user_id, now() - interval '60 minutes', now() - interval '30 minutes', 1800 FROM live_sessions;
SELECT pg_temp.tip('40 minutes');  -- 10 of the 30 paused min are after the tip -> 30 free
SELECT pg_temp.ok(abs(((get_live_free_clock())->>'paused_seconds')::numeric - 600) < 2, 'straddling pause: 10 min counted');
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL, 'straddle: 30 free min -> not ended');
DELETE FROM live_tips; DELETE FROM live_session_pauses; DELETE FROM live_sessions;

-- ── currently paused: time does not run ──
SELECT start_live_session('BongaCams', NULL);
UPDATE live_sessions SET status='live', live_substate='paused', started_at = now() - interval '3 hours', paused_at = now() - interval '2 hours', last_heartbeat_at = now();
INSERT INTO live_session_pauses (session_id, user_id, paused_at) SELECT id, user_id, paused_at FROM live_sessions;
SELECT pg_temp.tip('150 minutes');  -- 30 free min before the pause began
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL, 'paused at 30 free min for 2h -> not ended');
DELETE FROM live_tips; DELETE FROM live_session_pauses; DELETE FROM live_sessions;

-- ── tip received while paused, then resumed ──
SELECT start_live_session('BongaCams', NULL);
UPDATE live_sessions SET status='live', live_substate='active', started_at = now() - interval '2 hours', last_heartbeat_at = now();
INSERT INTO live_session_pauses (session_id, user_id, paused_at, resumed_at, pause_duration_seconds)
  SELECT id, user_id, now() - interval '70 minutes', now() - interval '40 minutes', 1800 FROM live_sessions;
SELECT pg_temp.tip('60 minutes');  -- tip during the pause; free time = 40 min since resume
SELECT pg_temp.ok((enforce_live_active_limit()).session_resolution_type = 'free_active_limit', 'tip during pause: counts from resume (40 > 35) -> ended');
SELECT pg_temp.ok((SELECT abs(EXTRACT(EPOCH FROM (now() - ended_at)) - 300) < 2 FROM live_sessions WHERE status='ended'), 'ended 5 min ago (35 min after resume)');
DELETE FROM live_tips; DELETE FROM live_session_pauses; DELETE FROM live_sessions;

-- ── Pro never ended ──
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
SELECT start_live_session('Chaturbate', NULL);
UPDATE live_sessions SET status='live', live_substate='active', started_at = now() - interval '5 hours';
SELECT pg_temp.tip('4 hours');
SELECT pg_temp.ok((enforce_live_active_limit()).id IS NULL AND sweep_free_live_active_limits() = 0, 'pro 4h after first tip untouched');
DELETE FROM live_tips; DELETE FROM live_sessions;

-- ── Private Skip ──
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000000f', false);
SELECT pg_temp.ok(pg_temp.err($$SELECT start_private_interval(NULL, NULL, NULL)$$) LIKE 'NO_LIVE_SESSION%', 'skip still needs a live session');
SELECT start_live_session('BongaCams', NULL);
UPDATE live_sessions SET status='live', live_substate='active', last_heartbeat_at = now();
SELECT pg_temp.ok(pg_temp.err($$SELECT start_private_interval(-1, NULL, 'fan')$$) LIKE 'INVALID_RATE%', 'a given rate must be >= 0');
SELECT pg_temp.ok(pg_temp.err($$SELECT start_private_interval(1001, NULL, 'fan')$$) LIKE 'INVALID_RATE%', 'a given rate must be <= 1000');
SELECT pg_temp.ok(pg_temp.err($$SELECT start_private_interval(NULL, NULL, repeat('x', 81))$$) LIKE 'USERNAME_REQUIRED%', 'username > 80 refused');
SELECT pg_temp.ok(pg_temp.err($$SELECT start_private_interval(NULL, 'Chaturbate', NULL)$$) LIKE 'PLATFORM_MISMATCH%', 'skip cannot change platform');
SELECT pg_temp.ok((start_private_interval(NULL, NULL, '  ')).platform = 'BongaCams', 'skip: started on session platform');
SELECT pg_temp.ok((SELECT username IS NULL AND rate_per_minute IS NULL FROM live_private_intervals), 'skip: username and rate stored as NULL (not 0)');
UPDATE live_private_intervals SET started_at = now() - interval '10 minutes';
SELECT end_private_interval();
SELECT pg_temp.ok((SELECT ended_at IS NOT NULL AND estimated_earnings_usd IS NULL FROM live_private_intervals), 'skip: closed with no invented estimate');
SELECT pg_temp.ok((start_private_interval(2.5, NULL, ' Fan_One ')).username = 'Fan_One', 'normal start still records username');
SELECT pg_temp.ok((SELECT rate_per_minute FROM live_private_intervals WHERE ended_at IS NULL) = 2.5, 'normal start still records rate');
SELECT end_private_interval();
UPDATE live_sessions SET status='ended', ended_at=now();
SELECT _finalize_live_session_metrics(pg_temp.sid());
SELECT pg_temp.ok((SELECT final_private_usd FROM live_sessions) = 0, 'finalized private $ = 0 (skip adds nothing; 2nd interval ~0 min): ' || (SELECT final_private_usd FROM live_sessions));
DELETE FROM live_private_intervals; DELETE FROM live_sessions;

-- ── grants ──
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public._live_free_clock(public.live_sessions, timestamptz)', 'EXECUTE'), 'creators cannot call the clock on arbitrary sessions');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public._live_free_clock(public.live_sessions, timestamptz)', 'EXECUTE'), 'anon cannot call the clock');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.get_live_free_clock()', 'EXECUTE'), 'anon cannot read clock');
SELECT pg_temp.ok(has_function_privilege('authenticated', 'public.get_live_free_clock()', 'EXECUTE'), 'creators can read own clock');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.sweep_free_live_active_limits()', 'EXECUTE'), 'creators still cannot run the global sweep');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public._end_live_session_at_free_limit(public.live_sessions)', 'EXECUTE'), 'creators still cannot end arbitrary sessions');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.start_private_interval(numeric,text,text)', 'EXECUTE'), 'anon cannot start private');
SELECT set_config('test.uid', '', false);
SELECT pg_temp.ok(pg_temp.err($$SELECT get_live_free_clock()$$) LIKE 'Not authenticated%', 'clock read requires auth');
