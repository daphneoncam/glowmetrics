-- Extend the live-session inactivity auto-end threshold from 20 to 30 minutes.
--
-- Both sweep functions carry identical staleness logic and must stay in step:
--   sweep_stale_live_session()      -- caller-scoped, runs on the /api/live/session poll
--   sweep_all_stale_live_sessions() -- SECURITY DEFINER, batch sweep
--
-- Only the terminal threshold changes (20 -> 30 minutes). The 10-minute
-- 'inactive_warning' step is deliberately unchanged, so the creator still gets
-- the early "still live?" signal well before the session is ended for her.
--
-- Idle time is already excluded from stream time and stays that way: ended_at
-- is backdated to last_heartbeat_at, never now(), so the silent window is never
-- counted toward session duration or earnings-per-active-hour.
--
-- Status vocabulary here ('live'/'inactive_warning'/'ended') is production's,
-- verified against live_sessions_status_check. Do not switch these literals to
-- the 'active'/'needs_resolution' vocabulary used in the application layer
-- without migrating the CHECK constraint and all 9 live-session RPCs together.
--
-- Reversible: re-apply the previous definitions with interval '20 minutes'.
-- Touches no rows, no columns, no constraints, no policies.

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
     AND now() - v_row.last_heartbeat_at >= interval '30 minutes' THEN
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
      WHERE status = 'inactive_warning' AND now() - last_heartbeat_at >= interval '30 minutes'
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
