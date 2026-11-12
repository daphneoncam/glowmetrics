-- Reconcile the Live Engine back into the repo, verbatim from PRODUCTION.
--
-- Read from production (hlsdlaibnayzbfflxclj) on 2026-10-11, read-only.
-- Production is the source of truth: the older repo migrations
-- (20260716b, 20260720c, 20260720e, 20261008) describe a previous status
-- vocabulary ('active'/'paused'/'needs_resolution') and a camera-based
-- 5/15-minute sweep that production no longer runs. Every function body
-- below is a byte-for-byte copy of production's prosrc, so applying this
-- file to production is a no-op. Parity is proven by md5(prosrc) — see
-- chrome-extension/tests/staging-only/live-session-write-lockdown-tests.sql.
--
-- This file changes NO behavior. It only records what production runs, so
-- the next migration (20261014b_lock_live_session_writes.sql) modifies the
-- real definitions rather than stale repo copies.
--
-- Not reconciled here (unchanged, out of scope): persist_extension_tip,
-- _close_private_intervals, start/end_private_interval, check_free_tier_platform_limit,
-- record_coaching_event_if_new, respond_to_coaching_event.

-- ── Status vocabulary (production) ───────────────────────────────────────
-- live_sessions.status:        starting | live | inactive_warning | ending | ended
-- live_sessions.live_substate: NULL | active | paused   (meaningful while status = 'live')
-- One running session per user: live_sessions_one_running_per_user
--   UNIQUE (user_id) WHERE status IN ('starting','live','inactive_warning','ending')
-- Stale handling (production):
--   * per-user  sweep_stale_live_session()  — called from GET /api/live/session and both heartbeats
--   * global    sweep_all_stale_live_sessions() — pg_cron 'sweep-stale-live-sessions' every 5 minutes
--   live + no heartbeat 10 min  -> inactive_warning (warning_started_at = last_heartbeat_at)
--   inactive_warning + no heartbeat 20 min -> back to live if a tip arrived since the last
--   heartbeat, otherwise ended at last_heartbeat_at ('auto_ended_inactivity') and finalized.

-- ── start_live_session ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_live_session(p_platform text DEFAULT NULL::text)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_platform text;
  v_result   public.live_sessions;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  v_platform := coalesce(nullif(trim(p_platform), ''), 'Chaturbate');
  if v_platform not in ('Chaturbate','BongaCams','MyFreeCams','Stripchat','CamSoda') then
    raise exception 'Unrecognized platform: %', v_platform using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.live_sessions
    where user_id = v_uid and status in ('starting','live','inactive_warning','ending')
  ) then
    perform public.check_live_mode_pro_entitlement(v_uid);
    perform public.check_free_tier_platform_limit(v_uid, v_platform);
  end if;

  begin
    insert into public.live_sessions (
      user_id, status, live_substate, is_active, started_at, ended_at,
      last_heartbeat_at, website_last_heartbeat_at, stream_platform
    ) values (
      v_uid, 'starting', null, true, now(), null,
      now(), now(), v_platform
    )
    returning * into v_result;
    return v_result;
  exception when unique_violation then
    select * into v_result
      from public.live_sessions
      where user_id = v_uid
        and status in ('starting','live','inactive_warning','ending')
      order by started_at desc
      limit 1;
    return v_result;
  end;
end;
$function$;

-- ── pause_live_session ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pause_live_session()
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.live_sessions
    SET live_substate = 'paused',
        paused_at = now(),
        last_heartbeat_at = now()
    WHERE user_id = v_uid AND status = 'live' AND live_substate = 'active'
    RETURNING * INTO v_result;

  IF v_result.id IS NOT NULL THEN
    INSERT INTO public.live_session_pauses (session_id, user_id, paused_at)
      VALUES (v_result.id, v_uid, v_result.paused_at);
  END IF;

  RETURN v_result; -- NULL if not currently live+active (repeated Pause = safe no-op)
END;
$function$;

-- ── resume_live_session ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resume_live_session()
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.live_sessions
    SET live_substate = 'active',
        total_paused_seconds = total_paused_seconds
          + GREATEST(0, EXTRACT(EPOCH FROM (now() - paused_at))::integer),
        paused_at = null,
        last_heartbeat_at = now()
    WHERE user_id = v_uid AND status = 'live' AND live_substate = 'paused'
    RETURNING * INTO v_result;

  IF v_result.id IS NOT NULL THEN
    UPDATE public.live_session_pauses
      SET resumed_at = now(),
          pause_duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - paused_at))::integer)
      WHERE session_id = v_result.id AND resumed_at IS NULL;
  END IF;

  RETURN v_result; -- NULL if not currently live+paused (repeated Resume = safe no-op)
END;
$function$;

-- ── _finalize_live_session_metrics ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._finalize_live_session_metrics(p_session_id uuid)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row            public.live_sessions;
  v_active_secs    numeric;
  v_tip_count      integer;
  v_unique_tippers integer;
  v_earnings       numeric;
  v_tokens         integer;
  v_largest_tip    numeric;
  v_avg_tip        numeric;
  v_pub_count      integer;
  v_pub_unique     integer;
  v_pub_usd        numeric;
  v_pub_tokens     integer;
  v_pub_largest    numeric;
  v_pub_avg        numeric;
  v_top_username   text;
  v_top_usd        numeric;
  v_private_usd    numeric;
  v_private_secs   integer;
  v_breakdown      jsonb;
  v_duration       integer;
BEGIN
  SELECT * INTO v_row FROM public.live_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_row.ended_at IS NULL THEN
    RETURN v_row;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_row.user_id::text, 0));

  PERFORM public._close_private_intervals(p_session_id, v_row.ended_at);

  v_active_secs := GREATEST(0,
    EXTRACT(EPOCH FROM (v_row.ended_at - v_row.started_at)) - v_row.total_paused_seconds
  );
  v_duration := GREATEST(0,
    EXTRACT(EPOCH FROM (v_row.ended_at - v_row.started_at))::integer - v_row.total_paused_seconds
  );

  SELECT
    COUNT(*), COUNT(DISTINCT (lower(platform), lower(username))),
    COALESCE(SUM(usd), 0), COALESCE(SUM(tokens), 0),
    COALESCE(MAX(usd), 0), COALESCE(AVG(usd), 0)
    INTO v_tip_count, v_unique_tippers, v_earnings, v_tokens, v_largest_tip, v_avg_tip
    FROM public.live_tips
    WHERE live_session_id = p_session_id;

  SELECT
    COUNT(*), COUNT(DISTINCT (lower(platform), lower(username))),
    COALESCE(SUM(usd), 0), COALESCE(SUM(tokens), 0),
    COALESCE(MAX(usd), 0), COALESCE(AVG(usd), 0)
    INTO v_pub_count, v_pub_unique, v_pub_usd, v_pub_tokens, v_pub_largest, v_pub_avg
    FROM public.tips
    WHERE live_session_id = p_session_id;

  SELECT min(username), SUM(usd)
    INTO v_top_username, v_top_usd
    FROM public.tips
    WHERE live_session_id = p_session_id
    GROUP BY lower(platform), lower(username)
    ORDER BY SUM(usd) DESC, lower(username), lower(platform)
    LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(platform, jsonb_build_object('usd', usd, 'tips', n)), '{}'::jsonb)
    INTO v_breakdown
    FROM (
      SELECT COALESCE(platform, 'unknown') AS platform, round(SUM(usd), 2) AS usd, COUNT(*) AS n
      FROM public.tips WHERE live_session_id = p_session_id
      GROUP BY 1
    ) b;

  SELECT COALESCE(SUM(estimated_earnings_usd), 0),
         COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))::integer), 0)
    INTO v_private_usd, v_private_secs
    FROM public.live_private_intervals
    WHERE live_session_id = p_session_id AND ended_at IS NOT NULL;

  UPDATE public.live_sessions
    SET session_earnings_usd     = v_earnings,
        session_tokens           = v_tokens,
        tip_count                = v_tip_count,
        unique_tipper_count      = v_unique_tippers,
        largest_tip_usd          = v_largest_tip,
        average_tip_usd          = v_avg_tip,
        earnings_per_active_hour = CASE WHEN v_active_secs > 0 THEN round((v_earnings / (v_active_secs / 3600.0))::numeric, 2) ELSE 0 END,
        tips_per_active_hour     = CASE WHEN v_active_secs > 0 THEN round((v_tip_count / (v_active_secs / 3600.0))::numeric, 2) ELSE 0 END,
        final_public_usd          = round(v_pub_usd, 2),
        final_private_usd         = round(v_private_usd, 2),
        final_private_seconds     = v_private_secs,
        final_platform_breakdown  = v_breakdown,
        final_total_usd           = round(v_pub_usd + v_private_usd, 2),
        final_tokens              = v_pub_tokens,
        final_tip_count           = v_pub_count,
        final_unique_tippers      = v_pub_unique,
        final_top_tipper_username = v_top_username,
        final_top_tipper_usd      = v_top_usd,
        final_largest_tip_usd     = v_pub_largest,
        final_avg_tip_usd         = round(v_pub_avg::numeric, 2),
        final_duration_seconds    = v_duration,
        final_usd_per_hour        = CASE WHEN v_duration > 0 THEN round(((v_pub_usd + v_private_usd) / v_duration) * 3600, 2) ELSE NULL END,
        finalized_at              = COALESCE(finalized_at, ended_at)
    WHERE id = p_session_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ── stop_live_session ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stop_live_session()
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_before public.live_sessions;
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  SELECT * INTO v_before FROM public.live_sessions
    WHERE user_id = v_uid
      AND status IN ('starting','live','inactive_warning','ending')
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.live_sessions
    SET status = 'ended',
        live_substate = null,
        is_active = false,
        ended_at = now(),
        last_heartbeat_at = now(),
        total_paused_seconds = total_paused_seconds
          + CASE WHEN paused_at IS NOT NULL
                 THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - paused_at))::integer)
                 ELSE 0 END,
        paused_at = null,
        warning_started_at = null,
        status_before_resolution = null,
        session_resolution_type = 'normal_stop'
    WHERE id = v_before.id
    RETURNING * INTO v_result;

  IF v_before.paused_at IS NOT NULL THEN
    UPDATE public.live_session_pauses
      SET resumed_at = v_result.ended_at,
          pause_duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (v_result.ended_at - paused_at))::integer)
      WHERE session_id = v_result.id AND resumed_at IS NULL;
  END IF;

  RETURN public._finalize_live_session_metrics(v_result.id);
END;
$function$;

-- ── resolve_live_session ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_live_session(p_choice text, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               uuid := auth.uid();
  v_current           public.live_sessions;
  v_result            public.live_sessions;
  v_uncertainty_start timestamptz;
  v_end_time          timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_choice NOT IN ('still_live', 'ended', 'end_at_last_heartbeat', 'choose_end_time', 'mark_invalid') THEN
    RAISE EXCEPTION 'Invalid choice: %', p_choice USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_current FROM public.live_sessions
    WHERE user_id = v_uid AND status = 'inactive_warning';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_uncertainty_start := COALESCE(v_current.warning_started_at, v_current.last_heartbeat_at);

  IF p_choice = 'still_live' THEN
    UPDATE public.live_sessions
      SET status = 'live',
          warning_started_at = null,
          total_paused_seconds = total_paused_seconds
            + CASE WHEN v_current.live_substate = 'active'
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(v_uncertainty_start, now())))::integer)
                   ELSE 0 END,
          extension_last_heartbeat_at = now(),
          broadcaster_page_missing_since = null,
          website_last_heartbeat_at = now(),
          last_heartbeat_at = now()
      WHERE id = v_current.id
      RETURNING * INTO v_result;
    RETURN v_result;
  END IF;

  IF p_choice = 'ended' THEN
    v_end_time := COALESCE(p_end_time, v_uncertainty_start, now());
  ELSIF p_choice = 'end_at_last_heartbeat' THEN
    v_end_time := COALESCE(v_current.extension_last_heartbeat_at, v_current.website_last_heartbeat_at, v_uncertainty_start, now());
  ELSIF p_choice = 'choose_end_time' THEN
    IF p_end_time IS NULL THEN
      RAISE EXCEPTION 'choose_end_time requires p_end_time' USING ERRCODE = '22023';
    END IF;
    v_end_time := p_end_time;
  ELSE -- mark_invalid
    v_end_time := COALESCE(v_uncertainty_start, now());
  END IF;

  UPDATE public.live_sessions
    SET status = 'ended',
        live_substate = null,
        is_active = false,
        warning_started_at = null,
        ended_at = v_end_time,
        total_paused_seconds = total_paused_seconds
          + CASE WHEN paused_at IS NOT NULL
                 THEN GREATEST(0, EXTRACT(EPOCH FROM (v_end_time - paused_at))::integer)
                 ELSE 0 END,
        paused_at = null,
        last_heartbeat_at = now(),
        session_resolution_type = CASE p_choice
          WHEN 'ended' THEN 'end_at_last_heartbeat'
          WHEN 'end_at_last_heartbeat' THEN 'end_at_last_heartbeat'
          WHEN 'choose_end_time' THEN 'chosen_end_time'
          ELSE 'marked_invalid'
        END,
        is_inaccurate = (p_choice = 'mark_invalid'),
        inaccuracy_reason = CASE WHEN p_choice = 'mark_invalid' THEN 'marked_invalid_by_user' ELSE inaccuracy_reason END
    WHERE id = v_current.id
    RETURNING * INTO v_result;

  RETURN public._finalize_live_session_metrics(v_result.id);
END;
$function$;

-- ── sweep_stale_live_session (per-user) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_stale_live_session()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               uuid := auth.uid();
  v_row               public.live_sessions;
  v_has_proof_of_life boolean;
  v_ended_at          timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.live_sessions
    WHERE user_id = v_uid AND status IN ('live', 'inactive_warning')
    ORDER BY started_at DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.status = 'live' AND now() - v_row.last_heartbeat_at >= interval '10 minutes' THEN
    UPDATE public.live_sessions
      SET status = 'inactive_warning',
          warning_started_at = v_row.last_heartbeat_at
      WHERE id = v_row.id;
    RETURN;
  END IF;

  IF v_row.status = 'inactive_warning'
     AND now() - v_row.last_heartbeat_at >= interval '20 minutes' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.live_tips
      WHERE user_id = v_uid AND received_at > v_row.last_heartbeat_at
    ) INTO v_has_proof_of_life;

    IF v_has_proof_of_life THEN
      UPDATE public.live_sessions
        SET status = 'live',
            warning_started_at = null,
            last_heartbeat_at = now()
        WHERE id = v_row.id;
      RETURN;
    END IF;

    v_ended_at := v_row.last_heartbeat_at;

    UPDATE public.live_sessions
      SET status = 'ended',
          live_substate = null,
          is_active = false,
          warning_started_at = null,
          ended_at = v_ended_at,
          total_paused_seconds = total_paused_seconds
            + CASE WHEN paused_at IS NOT NULL
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (v_ended_at - paused_at))::integer)
                   ELSE 0 END,
          paused_at = null,
          last_heartbeat_at = now(),
          session_resolution_type = 'auto_ended_inactivity'
      WHERE id = v_row.id
      RETURNING * INTO v_row;

    PERFORM public._finalize_live_session_metrics(v_row.id);
  END IF;
END;
$function$;

-- ── sweep_all_stale_live_sessions (pg_cron, every 5 minutes) ─────────────
CREATE OR REPLACE FUNCTION public.sweep_all_stale_live_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row               public.live_sessions;
  v_has_proof_of_life boolean;
  v_ended_at          timestamptz;
  v_swept             integer := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.live_sessions
      WHERE status = 'live' AND now() - last_heartbeat_at >= interval '10 minutes'
      FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.live_sessions
      SET status = 'inactive_warning',
          warning_started_at = v_row.last_heartbeat_at
      WHERE id = v_row.id;
    v_swept := v_swept + 1;
  END LOOP;

  FOR v_row IN
    SELECT * FROM public.live_sessions
      WHERE status = 'inactive_warning' AND now() - last_heartbeat_at >= interval '20 minutes'
      FOR UPDATE SKIP LOCKED
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.live_tips
      WHERE user_id = v_row.user_id AND received_at > v_row.last_heartbeat_at
    ) INTO v_has_proof_of_life;

    IF v_has_proof_of_life THEN
      UPDATE public.live_sessions
        SET status = 'live', warning_started_at = null, last_heartbeat_at = now()
        WHERE id = v_row.id;
      v_swept := v_swept + 1;
      CONTINUE;
    END IF;

    v_ended_at := v_row.last_heartbeat_at;

    UPDATE public.live_sessions
      SET status = 'ended',
          live_substate = null,
          is_active = false,
          warning_started_at = null,
          ended_at = v_ended_at,
          total_paused_seconds = total_paused_seconds
            + CASE WHEN paused_at IS NOT NULL
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (v_ended_at - paused_at))::integer)
                   ELSE 0 END,
          paused_at = null,
          last_heartbeat_at = now(),
          session_resolution_type = 'auto_ended_inactivity'
      WHERE id = v_row.id
      RETURNING * INTO v_row;

    PERFORM public._finalize_live_session_metrics(v_row.id);
    v_swept := v_swept + 1;
  END LOOP;

  RETURN v_swept;
END;
$function$;

-- ── send_website_heartbeat ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_website_heartbeat()
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM public.sweep_stale_live_session();

  UPDATE public.live_sessions
    SET website_last_heartbeat_at = now(),
        last_heartbeat_at = now(),
        status = CASE
          WHEN status = 'starting' THEN 'live'
          WHEN status = 'inactive_warning' THEN 'live'
          ELSE status
        END,
        live_substate = CASE
          WHEN status = 'starting' THEN 'active'
          ELSE live_substate
        END,
        warning_started_at = CASE WHEN status = 'inactive_warning' THEN null ELSE warning_started_at END
    WHERE user_id = v_uid AND status IN ('starting', 'live', 'inactive_warning')
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

-- ── send_extension_heartbeat ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_extension_heartbeat(p_platform text, p_broadcaster_page_detected boolean)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- STARTING -> LIVE: this is the extension's first ack, matching the
  -- required flow ("Extension connects -> Heartbeat begins -> Dashboard
  -- timer starts"). live_substate begins at 'active'.
  UPDATE public.live_sessions
    SET extension_last_heartbeat_at = now(),
        extension_platform = p_platform,
        broadcaster_page_detected = p_broadcaster_page_detected,
        last_heartbeat_at = now(),
        status = CASE
          WHEN status = 'starting' THEN 'live'
          WHEN status = 'inactive_warning' THEN 'live'
          ELSE status
        END,
        live_substate = CASE
          WHEN status = 'starting' THEN 'active'
          ELSE live_substate
        END,
        warning_started_at = CASE WHEN status = 'inactive_warning' THEN null ELSE warning_started_at END
    WHERE user_id = v_uid AND status IN ('starting', 'live', 'inactive_warning')
    RETURNING * INTO v_result;

  PERFORM public.sweep_stale_live_session();

  IF v_result IS NULL THEN
    SELECT * INTO v_result FROM public.live_sessions
      WHERE user_id = v_uid AND status IN ('starting', 'inactive_warning', 'ending');
  END IF;

  RETURN v_result;
END;
$function$;

-- ── clear_live_session_tips ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clear_live_session_tips()
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.live_sessions
    SET tips_cleared_at = now()
    WHERE user_id = v_uid
      AND status IN ('starting','live','inactive_warning','ending')
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

-- ── acknowledge_live_session ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acknowledge_live_session(p_session_id uuid)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.live_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  UPDATE public.live_sessions
     SET dashboard_seen_at = COALESCE(dashboard_seen_at, now())
   WHERE id = p_session_id AND user_id = auth.uid() AND finalized_at IS NOT NULL
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- ── set_live_session_coaching_strategy ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_live_session_coaching_strategy(p_strategy text)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_strategy NOT IN ('balanced', 'aggressive', 'retention', 'engagement', 'whale', 'goal') THEN
    RAISE EXCEPTION 'Invalid strategy: %', p_strategy USING ERRCODE = '22023';
  END IF;

  UPDATE public.live_sessions
    SET coaching_strategy = p_strategy
    WHERE user_id = v_uid
      AND status IN ('starting', 'live', 'inactive_warning', 'ending')
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

-- ── set_live_session_goal_tokens ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_live_session_goal_tokens(p_goal_tokens integer)
 RETURNS live_sessions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_goal_tokens IS NULL OR p_goal_tokens < 0 THEN
    RAISE EXCEPTION 'Invalid goal_tokens: %', p_goal_tokens USING ERRCODE = '22023';
  END IF;

  UPDATE public.live_sessions
    SET coaching_goal_tokens = p_goal_tokens
    WHERE user_id = v_uid
      AND status IN ('starting', 'live', 'inactive_warning', 'ending')
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

-- ── check_live_mode_pro_entitlement (UNCHANGED gate — recorded only) ─────
-- Free users are still blocked from starting Live Mode. Loosening this is a
-- separate, later change (35-minute Free Live Mode) and is NOT done here.
CREATE OR REPLACE FUNCTION public.check_live_mode_pro_entitlement(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  user_plan text;
  user_plan_expires_at timestamptz;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'NOT_AUTHORIZED' using errcode = '28000';
  end if;

  select plan, plan_expires_at into user_plan, user_plan_expires_at
  from profiles where id = p_user_id;

  if user_plan is not null and user_plan not in ('free')
     and (user_plan_expires_at is null or user_plan_expires_at > now()) then
    return;
  end if;

  raise exception 'LIVE_MODE_REQUIRES_PRO: Live Mode is a Pro feature. Upgrade to Pro to start a live session.'
    using errcode = 'P0001';
end;
$function$;

-- ── enforce_live_mode_pro_entitlement (trigger, UNCHANGED) ───────────────
CREATE OR REPLACE FUNCTION public.enforce_live_mode_pro_entitlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- auth.uid() is null for service-role and maintenance contexts (the pg_cron
  -- stale-session sweep, migrations, backfills). Those are not creator actions
  -- and must not be gated on a creator's plan; the bypass this migration
  -- closes is specifically an *authenticated* PostgREST caller.
  if auth.uid() is null then
    return new;
  end if;

  -- A row for somebody else is refused by the policy's WITH CHECK regardless.
  -- Returning here keeps the guard from reading a plan for a user id the
  -- caller supplied, which would turn this trigger into a Pro-status oracle.
  if new.user_id is distinct from auth.uid() then
    return new;
  end if;

  -- Mirrors start_live_session()'s in-progress exemption verbatim.
  if exists (
    select 1 from public.live_sessions
    where user_id = new.user_id
      and status in ('starting', 'live', 'inactive_warning', 'ending')
  ) then
    return new;
  end if;

  -- The canonical check. Raises LIVE_MODE_REQUIRES_PRO (P0001) for free,
  -- null-plan, and expired pro/trial; returns quietly for active pro,
  -- unlimited, and an unexpired promo-code trial grant.
  perform public.check_live_mode_pro_entitlement(auth.uid());

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_live_mode_pro_entitlement ON public.live_sessions;
CREATE TRIGGER trg_enforce_live_mode_pro_entitlement
  BEFORE INSERT ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_live_mode_pro_entitlement();

-- ── Policies as they exist in production (recorded; changed in 20261014b) ─
-- live_sessions:
--   "Users manage own live sessions"                 FOR ALL    USING/CHECK ((SELECT auth.uid()) = user_id)
--   "studio admin read linked model live_sessions"   FOR SELECT USING is_linked_studio_admin(user_id)
-- live_session_pauses:
--   live_session_pauses_select_own  FOR SELECT USING (auth.uid() = user_id)
--   live_session_pauses_insert_own  FOR INSERT CHECK (auth.uid() = user_id)
--   live_session_pauses_update_own  FOR UPDATE USING/CHECK (auth.uid() = user_id)
-- Table grants (production): anon and authenticated hold
--   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on both tables.
