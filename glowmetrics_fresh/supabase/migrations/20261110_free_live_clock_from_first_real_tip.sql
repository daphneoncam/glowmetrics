-- Free Live Mode: the 35-active-minute clock starts at the first REAL tip,
-- not when the creator presses Start; and a private show may be started
-- without a fan username or rate ("Skip").
--
-- Written against production's live definitions read on 2026-11-10 via
-- pg_get_functiondef (_end_live_session_at_free_limit,
-- sweep_free_live_active_limits, start_private_interval(numeric,text,text)).
-- Only the lines that compute "active seconds" change in the first two.
--
-- 1. Free clock
--    clock start  = the earliest live_tips.received_at of tips attributed to
--                   this session (never before the session's started_at).
--                   Test tips are never saved (app/api/live/tips/route.js),
--                   so every live_tips row is a real tip. "Clear Feed" only
--                   sets tips_cleared_at, it never deletes tips, so it can't
--                   restart the clock.
--    free active  = (ref - clock start) - paused time AFTER clock start,
--                   ref = paused_at if paused, else now() (the same ref the
--                   existing code uses). Pauses come from
--                   live_session_pauses (verified 2026-11-10: it matches
--                   total_paused_seconds for every production session).
--    No tip yet   = no clock, nothing is ended. The existing inactivity /
--                   stale-session sweep is unchanged and still ends
--                   abandoned streams. The 2-streams-per-week count is
--                   unchanged (a stream still counts when it starts).
--    Pro          = unchanged (never ended).
--
-- 2. Private "Skip": start_private_interval accepts NULL rate and an empty
--    username (stored as NULL). A NULL rate gives a NULL estimate in
--    _close_private_intervals (rate * minutes), and
--    _finalize_live_session_metrics sums with COALESCE(SUM(..),0), so a
--    skipped show adds $0 to totals rather than an invented amount; its
--    private minutes are still counted. Platform rules are unchanged: the
--    platform is always the running session's own.
--
-- Not changed: start_live_session, weekly allowance, _finalize, tips,
-- live_tips writes, RLS, the 2-argument start_private_interval.

BEGIN;

-- Lookup for the clock start (live_tips had no index on live_session_id).
CREATE INDEX IF NOT EXISTS idx_live_tips_live_session_received
  ON public.live_tips (live_session_id, received_at)
  WHERE live_session_id IS NOT NULL;

-- ── 1a. The one implementation of the Free clock ──────────────────────────
CREATE OR REPLACE FUNCTION public._live_free_clock(
  p_session public.live_sessions,
  p_ref timestamptz,
  OUT clock_started_at timestamptz,
  OUT paused_seconds numeric,
  OUT active_seconds numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_first timestamptz;
BEGIN
  SELECT min(t.received_at) INTO v_first
    FROM public.live_tips t
   WHERE t.live_session_id = p_session.id;

  -- GREATEST ignores NULLs, so the no-tip case must be handled first.
  IF v_first IS NULL THEN
    RETURN;  -- all three OUT values NULL: the clock has not started
  END IF;

  clock_started_at := LEAST(GREATEST(p_session.started_at, v_first), p_ref);

  SELECT COALESCE(sum(GREATEST(0, EXTRACT(EPOCH FROM (
           LEAST(COALESCE(x.resumed_at, p_ref), p_ref) - GREATEST(x.paused_at, clock_started_at)
         )))), 0)
    INTO paused_seconds
    FROM public.live_session_pauses x
   WHERE x.session_id = p_session.id;

  active_seconds := GREATEST(0, EXTRACT(EPOCH FROM (p_ref - clock_started_at)) - paused_seconds);
END;
$$;
REVOKE ALL ON FUNCTION public._live_free_clock(public.live_sessions, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._live_free_clock(public.live_sessions, timestamptz) TO service_role;

-- ── 1b. End-at-limit: production body, active seconds now from the clock ──
CREATE OR REPLACE FUNCTION public._end_live_session_at_free_limit(p_session public.live_sessions)
RETURNS public.live_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ref     timestamptz := COALESCE(p_session.paused_at, now());
  v_limit   integer := public.live_free_active_seconds_per_stream();
  v_active  numeric;
  v_cap_at  timestamptz;
  v_result  public.live_sessions;
BEGIN
  IF p_session.status NOT IN ('starting', 'live', 'inactive_warning') THEN
    RETURN NULL;
  END IF;
  IF public.is_live_mode_pro(p_session.user_id) THEN
    RETURN NULL;
  END IF;

  -- Free minutes count only from the first real tip.
  v_active := (public._live_free_clock(p_session, v_ref)).active_seconds;
  IF v_active IS NULL OR v_active < v_limit THEN
    RETURN NULL;
  END IF;

  v_cap_at := v_ref - make_interval(secs => (v_active - v_limit)::double precision);

  IF p_session.status = 'inactive_warning' AND v_cap_at > p_session.last_heartbeat_at THEN
    RETURN NULL;
  END IF;

  UPDATE public.live_sessions
     SET status = 'ended',
         live_substate = null,
         is_active = false,
         ended_at = v_cap_at,
         last_heartbeat_at = now(),
         paused_at = null,
         warning_started_at = null,
         status_before_resolution = null,
         session_resolution_type = 'free_active_limit'
   WHERE id = p_session.id
   RETURNING * INTO v_result;

  IF p_session.paused_at IS NOT NULL THEN
    UPDATE public.live_session_pauses
       SET resumed_at = paused_at, pause_duration_seconds = 0
     WHERE session_id = p_session.id AND resumed_at IS NULL;
  END IF;

  RETURN public._finalize_live_session_metrics(v_result.id);
END;
$function$;
REVOKE ALL ON FUNCTION public._end_live_session_at_free_limit(public.live_sessions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._end_live_session_at_free_limit(public.live_sessions) TO service_role;

-- ── 1c. Sweep: production body; the stream-time filter stays as a cheap
-- pre-filter (free active time can never exceed stream active time), and
-- _end_live_session_at_free_limit makes the real decision.
CREATE OR REPLACE FUNCTION public.sweep_free_live_active_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row   public.live_sessions;
  v_ended integer := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.live_sessions
     WHERE status IN ('starting', 'live', 'inactive_warning')
       AND EXTRACT(EPOCH FROM (COALESCE(paused_at, now()) - started_at)) - COALESCE(total_paused_seconds, 0)
           >= public.live_free_active_seconds_per_stream()
     FOR UPDATE SKIP LOCKED
  LOOP
    IF (public._end_live_session_at_free_limit(v_row)).id IS NOT NULL THEN
      v_ended := v_ended + 1;
    END IF;
  END LOOP;
  RETURN v_ended;
END;
$function$;
REVOKE ALL ON FUNCTION public.sweep_free_live_active_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_free_live_active_limits() TO service_role;

-- ── 1d. Read model for the progress bar (caller's own running session) ────
-- paused_seconds is pause time after the clock start up to ref, so the page
-- can tick: free active = (paused_at ?? now) - clock_started_at - paused_seconds.
CREATE OR REPLACE FUNCTION public.get_live_free_clock()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.live_sessions;
  v_clock record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.live_sessions
   WHERE user_id = v_uid AND status IN ('starting', 'live', 'inactive_warning', 'ending')
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_clock FROM public._live_free_clock(v_row, COALESCE(v_row.paused_at, now()));
  RETURN jsonb_build_object(
    'session_id', v_row.id,
    'clock_started_at', v_clock.clock_started_at,
    'paused_seconds', v_clock.paused_seconds
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_live_free_clock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_live_free_clock() TO authenticated;

-- ── 2. Private "Skip": rate and username optional ─────────────────────────
ALTER TABLE public.live_private_intervals ALTER COLUMN rate_per_minute DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.start_private_interval(p_rate_per_minute numeric, p_platform text, p_username text)
RETURNS public.live_private_intervals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_session   public.live_sessions;
  v_row       public.live_private_intervals;
  v_username  text := NULLIF(btrim(COALESCE(p_username, '')), '');
  v_platform  text;
  v_detected  text;
  v_requested text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  -- NULL = skipped. A rate that IS given must still be in range.
  IF p_rate_per_minute IS NOT NULL AND (p_rate_per_minute < 0 OR p_rate_per_minute > 1000) THEN
    RAISE EXCEPTION 'INVALID_RATE: rate_per_minute must be between 0 and 1000' USING ERRCODE = '22023';
  END IF;
  IF v_username IS NOT NULL AND length(v_username) > 80 THEN
    RAISE EXCEPTION 'USERNAME_REQUIRED: fan username is required (80 characters max)' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  SELECT * INTO v_session FROM public.live_sessions
   WHERE user_id = v_uid AND status IN ('live', 'inactive_warning')
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_LIVE_SESSION: start private only while live' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.live_private_intervals
   WHERE live_session_id = v_session.id AND ended_at IS NULL;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  v_platform  := public.canonical_platform_name(v_session.stream_platform);
  v_detected  := public.canonical_platform_name(v_session.extension_platform);
  v_requested := public.canonical_platform_name(p_platform);

  IF v_platform IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_UNKNOWN: the live session has no platform' USING ERRCODE = '22023';
  END IF;
  IF v_detected IS NOT NULL AND lower(v_detected) <> lower(v_platform) THEN
    RAISE EXCEPTION 'PLATFORM_MISMATCH: session platform % but extension detected %', v_platform, v_detected
      USING ERRCODE = '22023';
  END IF;
  IF v_requested IS NOT NULL AND lower(v_requested) <> lower(v_platform) THEN
    RAISE EXCEPTION 'PLATFORM_MISMATCH: session platform % but % was requested', v_platform, v_requested
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.live_private_intervals (user_id, live_session_id, platform, username, rate_per_minute)
  VALUES (v_uid, v_session.id, v_platform, v_username, p_rate_per_minute)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.start_private_interval(numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_private_interval(numeric, text, text) TO authenticated;

COMMIT;
