-- Live Mode Free allowance + Private Mode attribution + platform-cap removal.
--
-- APPLIED TO PRODUCTION 2026-11-04 (schema_migrations version 20261104002930).
-- Originally written against production's live function
-- definitions as of 2026-10-28 (read via pg_get_functiondef), which differ
-- from the repo copies: production already gates Live Mode to Pro through
-- check_live_mode_pro_entitlement() (migration gate_live_mode_pro_only,
-- recorded in production history but absent from this folder).
--
-- What changes:
--   1. Removes the Free 3-platform DATABASE INGESTION ceiling (the three
--      trg_enforce_platform_limit_* triggers). Analytics visibility rules for
--      Free are application reads and are not touched here.
--   2. Live Mode is no longer Pro-only. Free gets:
--        * 2 newly-started streams per week; the week starts Monday 00:00 in
--          the creator's IANA timezone (profiles.timezone, else the zone the
--          browser reported, else UTC — the same order as
--          lib/creatorTimezone.js resolveCreatorTimeZone);
--        * 35 ACTIVE minutes per stream (paused time excluded), enforced here,
--          server-side; the stream is ended at the exact moment it reached 35
--          active minutes.
--      Pro is decided by the ONE existing rule (is_live_mode_pro, extracted
--      verbatim from check_live_mode_pro_entitlement). Trial behaviour is
--      therefore unchanged.
--   3. Private intervals record the fan username and the canonical platform
--      of the running session. The platform is never guessed: if it cannot be
--      determined, or a supplied platform disagrees, nothing is saved.
--
-- Not changed: start_live_session's check_free_tier_platform_limit call, the
-- live_sessions write lockdown (RLS + direct-insert trigger), session timing
-- (started_at / total_paused_seconds / paused_at), _finalize_live_session_metrics.

BEGIN;

-- ── 1. Remove the 3-platform ingestion ceiling ─────────────────────────────
DROP TRIGGER IF EXISTS trg_enforce_platform_limit_tips ON public.tips;
DROP TRIGGER IF EXISTS trg_enforce_platform_limit_live_tips ON public.live_tips;
DROP TRIGGER IF EXISTS trg_enforce_platform_limit_paid_sessions ON public.paid_sessions;

-- ── 2a. The one Pro rule, extracted unchanged ─────────────────────────────
-- Identical predicate to production's check_live_mode_pro_entitlement():
-- plan set, not 'free', and plan_expires_at unset or in the future.
CREATE OR REPLACE FUNCTION public.is_live_mode_pro(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT plan IS NOT NULL AND plan NOT IN ('free')
       AND (plan_expires_at IS NULL OR plan_expires_at > now())
    FROM public.profiles WHERE id = p_user_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.is_live_mode_pro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_live_mode_pro(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.check_live_mode_pro_entitlement(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '28000';
  END IF;
  IF public.is_live_mode_pro(p_user_id) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'LIVE_MODE_REQUIRES_PRO: Live Mode is a Pro feature. Upgrade to Pro to start a live session.'
    USING ERRCODE = 'P0001';
END;
$$;
-- Was executable by PUBLIC/anon; it only ever answers for the caller, but
-- nothing outside a signed-in session needs it.
REVOKE ALL ON FUNCTION public.check_live_mode_pro_entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_live_mode_pro_entitlement(uuid) TO authenticated, service_role;

-- ── 2b. Free allowance constants and week boundary ────────────────────────
CREATE OR REPLACE FUNCTION public.live_free_streams_per_week() RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;
CREATE OR REPLACE FUNCTION public.live_free_active_seconds_per_stream() RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT 35 * 60 $$;

-- Resolution order matches lib/creatorTimezone.js: saved zone, then the
-- browser-reported zone, then UTC. Only real IANA names are accepted.
CREATE OR REPLACE FUNCTION public._live_creator_timezone(p_user_id uuid, p_client_tz text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.timezone FROM public.profiles p
       WHERE p.id = p_user_id
         AND p.timezone IN (SELECT name FROM pg_timezone_names)),
    (SELECT name FROM pg_timezone_names WHERE name = btrim(p_client_tz) LIMIT 1),
    'UTC')
$$;

-- Monday 00:00 of the current week on the creator's clock, as an instant.
CREATE OR REPLACE FUNCTION public._live_week_start(p_tz text, p_at timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT date_trunc('week', p_at AT TIME ZONE p_tz) AT TIME ZONE p_tz
$$;

REVOKE ALL ON FUNCTION public._live_creator_timezone(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._live_creator_timezone(uuid, text) TO service_role;

-- ── 2c. Start entitlement (replaces Pro-only gate at start) ───────────────
CREATE OR REPLACE FUNCTION public.check_live_mode_start_entitlement(p_user_id uuid, p_client_tz text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tz    text;
  v_count integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '28000';
  END IF;
  IF public.is_live_mode_pro(p_user_id) THEN
    RETURN;
  END IF;

  v_tz := public._live_creator_timezone(p_user_id, p_client_tz);
  SELECT count(*) INTO v_count
    FROM public.live_sessions
   WHERE user_id = p_user_id
     AND started_at >= public._live_week_start(v_tz);

  IF v_count >= public.live_free_streams_per_week() THEN
    RAISE EXCEPTION 'FREE_LIVE_WEEKLY_LIMIT: Free Live Mode includes 2 streams per week. Upgrade to Pro for unlimited Live Mode.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.check_live_mode_start_entitlement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_live_mode_start_entitlement(uuid, text) TO authenticated, service_role;

-- start_live_session: production body, with the entitlement call swapped and
-- an optional browser timezone. Same defaults, same platform roster, same
-- free-tier platform check, same unique-violation handling.
DROP FUNCTION IF EXISTS public.start_live_session(text);
CREATE FUNCTION public.start_live_session(p_platform text DEFAULT NULL::text, p_timezone text DEFAULT NULL::text)
RETURNS live_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
    perform public.check_live_mode_start_entitlement(v_uid, p_timezone);
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
REVOKE ALL ON FUNCTION public.start_live_session(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_live_session(text, text) TO authenticated, service_role;

-- Direct-insert lockdown trigger: same guards, same exemptions; the gate it
-- applies is now the start entitlement (Pro, or Free within 2 per week).
CREATE OR REPLACE FUNCTION public.enforce_live_mode_pro_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  -- auth.uid() is null for service-role and maintenance contexts (the pg_cron
  -- sweeps, migrations, backfills). Those are not creator actions.
  if auth.uid() is null then
    return new;
  end if;

  -- A row for somebody else is refused by the policy's WITH CHECK regardless.
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

  perform public.check_live_mode_start_entitlement(auth.uid(), null);
  return new;
end;
$function$;

-- ── 2d. 35 active minutes per Free stream, enforced server-side ───────────
ALTER TABLE public.live_sessions DROP CONSTRAINT IF EXISTS live_sessions_resolution_type_check;
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_resolution_type_check
  CHECK (session_resolution_type IS NULL OR session_resolution_type = ANY (ARRAY[
    'normal_stop', 'still_live', 'end_at_last_heartbeat', 'chosen_end_time',
    'marked_invalid', 'auto_ended_inactivity', 'free_active_limit'
  ]));

-- Ends one Free session that has used its active allowance, at the exact
-- instant it reached the limit. Uses the canonical timing columns only:
--   active = (paused_at or now) - started_at - total_paused_seconds
-- (an open pause is excluded, as in lib/liveSession/shape.js). Returns the
-- finalized row, or NULL when nothing was ended. Caller must hold the row lock.
CREATE OR REPLACE FUNCTION public._end_live_session_at_free_limit(p_session public.live_sessions)
RETURNS public.live_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  v_active := EXTRACT(EPOCH FROM (v_ref - p_session.started_at)) - COALESCE(p_session.total_paused_seconds, 0);
  IF v_active < v_limit THEN
    RETURN NULL;
  END IF;

  -- The limit was reached before v_ref by (active - limit) seconds of
  -- unpaused time, so it was reached at exactly v_ref - (active - limit).
  v_cap_at := v_ref - make_interval(secs => (v_active - v_limit)::double precision);

  -- No heartbeat since before the cap: the creator may have left before it,
  -- so the existing stale-session sweep decides the end time, not this.
  IF p_session.status = 'inactive_warning' AND v_cap_at > p_session.last_heartbeat_at THEN
    RETURN NULL;
  END IF;

  UPDATE public.live_sessions
     SET status = 'ended',
         live_substate = null,
         is_active = false,
         ended_at = v_cap_at,
         last_heartbeat_at = now(),
         -- A pause still open began after the cap: it adds no paused time
         -- inside the session (paused_at >= v_cap_at by construction).
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
$$;
REVOKE ALL ON FUNCTION public._end_live_session_at_free_limit(public.live_sessions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._end_live_session_at_free_limit(public.live_sessions) TO service_role;

-- Caller-scoped: called by every Live route that a running page or the
-- extension hits (session poll, both heartbeats, resume, private start).
CREATE OR REPLACE FUNCTION public.enforce_live_active_limit()
RETURNS public.live_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.live_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  SELECT * INTO v_row FROM public.live_sessions
   WHERE user_id = v_uid AND status IN ('starting', 'live', 'inactive_warning')
   ORDER BY started_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public._end_live_session_at_free_limit(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_live_active_limit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_live_active_limit() TO authenticated;

-- Account-wide sweep for streams nobody is polling (tab closed, extension
-- only). Scheduled every minute below.
CREATE OR REPLACE FUNCTION public.sweep_free_live_active_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    -- .id, not the row: a composite IS NOT NULL needs every column non-null.
    IF (public._end_live_session_at_free_limit(v_row)).id IS NOT NULL THEN
      v_ended := v_ended + 1;
    END IF;
  END LOOP;
  RETURN v_ended;
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_free_live_active_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_free_live_active_limits() TO service_role;

SELECT cron.schedule('sweep-free-live-active-limits', '* * * * *',
  'SELECT public.sweep_free_live_active_limits();');

-- ── 2e. Allowance read model for the progress bar ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_live_mode_allowance(p_timezone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_tz    text;
  v_start timestamptz;
  v_used  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.is_live_mode_pro(v_uid) THEN
    RETURN jsonb_build_object('unlimited', true);
  END IF;

  v_tz := public._live_creator_timezone(v_uid, p_timezone);
  v_start := public._live_week_start(v_tz);
  SELECT count(*) INTO v_used FROM public.live_sessions
   WHERE user_id = v_uid AND started_at >= v_start;

  RETURN jsonb_build_object(
    'unlimited', false,
    'timezone', v_tz,
    'streams_per_week', public.live_free_streams_per_week(),
    'streams_used', v_used,
    'active_seconds_per_stream', public.live_free_active_seconds_per_stream(),
    'week_started_at', v_start,
    'resets_at', v_start + interval '7 days'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_live_mode_allowance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_live_mode_allowance(text) TO authenticated;

-- ── 3. Private intervals: fan username + explicit canonical platform ──────
ALTER TABLE public.live_private_intervals ADD COLUMN IF NOT EXISTS username text;
CREATE INDEX IF NOT EXISTS idx_live_private_intervals_user_platform_username
  ON public.live_private_intervals (user_id, platform, lower(username))
  WHERE username IS NOT NULL;

-- The platform is the running session's, canonicalized. It is refused (not
-- guessed) when the session platform is unknown, when the extension has
-- detected a different platform on the broadcaster page, or when the caller
-- supplied a platform that disagrees.
CREATE OR REPLACE FUNCTION public.start_private_interval(p_rate_per_minute numeric, p_platform text, p_username text)
RETURNS public.live_private_intervals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_session   public.live_sessions;
  v_row       public.live_private_intervals;
  v_username  text := btrim(COALESCE(p_username, ''));
  v_platform  text;
  v_detected  text;
  v_requested text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_rate_per_minute IS NULL OR p_rate_per_minute < 0 OR p_rate_per_minute > 1000 THEN
    RAISE EXCEPTION 'INVALID_RATE: rate_per_minute must be between 0 and 1000' USING ERRCODE = '22023';
  END IF;
  IF v_username = '' OR length(v_username) > 80 THEN
    RAISE EXCEPTION 'USERNAME_REQUIRED: fan username is required (80 characters max)' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  SELECT * INTO v_session FROM public.live_sessions
   WHERE user_id = v_uid AND status IN ('live', 'inactive_warning')
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_LIVE_SESSION: start private only while live' USING ERRCODE = '22023';
  END IF;

  -- Already private (refresh, second tab, double click): return that one.
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
  -- lower(): canonical_platform_name only fixes case for CB/BC/MFC.
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
$$;
REVOKE ALL ON FUNCTION public.start_private_interval(numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_private_interval(numeric, text, text) TO authenticated;

-- The 2-argument start_private_interval stays for already-deployed web
-- clients until this release is live; drop it in a follow-up migration.

COMMIT;
