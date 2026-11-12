-- Lock Live Mode session writes to the server-side lifecycle functions.
--
-- Vulnerability (production, found 2026-10-11): the authenticated role held
-- table-wide INSERT/UPDATE/DELETE/TRUNCATE on public.live_sessions and
-- public.live_session_pauses, and the policies allowed a signed-in user to
-- write any column of their own rows. From the browser a user could run
--   supabase.from('live_sessions').update({ final_total_usd: 99999, started_at: ... })
--   supabase.from('live_sessions').delete().eq('id', ...)
--   supabase.from('live_session_pauses').update({ pause_duration_seconds: ... })
-- and rewrite their own session timing, status, platform and finalized
-- earnings, or delete sessions outright.
--
-- Fix:
--  1. The lifecycle functions that write these tables become SECURITY DEFINER
--     (owner postgres, which owns both tables) with a pinned search_path.
--     Their BODIES ARE NOT CHANGED — they are production's verbatim bodies
--     reconciled in 20261014_reconcile_live_engine_production_baseline.sql.
--     Every one of them already scopes every read and write to auth.uid()
--     (user_id = v_uid / auth.uid()), and raises 28000 when auth.uid() is NULL
--     (sweep_stale_live_session returns quietly instead, as before).
--  2. _finalize_live_session_metrics takes a session id and has no ownership
--     check of its own, so as DEFINER it must not be callable by end users.
--     EXECUTE is revoked from PUBLIC/anon/authenticated; it is only ever
--     called from inside the DEFINER lifecycle functions, persist_extension_tip
--     and the pg_cron sweep — all of which run as postgres.
--  3. Browser roles lose INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on
--     both tables (table- and column-level). SELECT is kept: the API routes,
--     post-show summaries and Realtime read through it.
--  4. Policies: the FOR ALL policy on live_sessions becomes FOR SELECT with
--     the same predicate; the INSERT/UPDATE policies on live_session_pauses
--     are dropped. The studio-admin SELECT policy is untouched.
--
-- Unchanged: session semantics, status vocabulary, heartbeat/stale timings,
-- the pg_cron sweep, analytics/finalization formulas, the Pro start gate
-- (check_live_mode_pro_entitlement / trg_enforce_live_mode_pro_entitlement),
-- service_role access, Realtime publication membership.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- Preconditions: the reconciled production definitions must be in place.
DO $$
BEGIN
  IF to_regprocedure('public._finalize_live_session_metrics(uuid)') IS NULL
     OR to_regprocedure('public.start_live_session(text)') IS NULL
     OR to_regprocedure('public.sweep_stale_live_session()') IS NULL THEN
    RAISE EXCEPTION 'Live Engine functions missing — apply 20261014_reconcile_live_engine_production_baseline.sql first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_sessions_status_check'
      AND pg_get_constraintdef(oid) LIKE '%inactive_warning%'
  ) THEN
    RAISE EXCEPTION 'live_sessions does not use the production status vocabulary. Aborting.';
  END IF;
END $$;

-- 1. Lifecycle functions → SECURITY DEFINER, pinned search_path ─────────────
-- pg_temp is listed last so a temporary object can never shadow a public one.
ALTER FUNCTION public.start_live_session(text)                       SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.pause_live_session()                           SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.resume_live_session()                          SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.stop_live_session()                            SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.resolve_live_session(text, timestamptz)        SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.sweep_stale_live_session()                     SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.send_website_heartbeat()                       SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.send_extension_heartbeat(text, boolean)        SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.clear_live_session_tips()                      SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.acknowledge_live_session(uuid)                 SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.set_live_session_coaching_strategy(text)       SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.set_live_session_goal_tokens(integer)          SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public._finalize_live_session_metrics(uuid)           SECURITY DEFINER SET search_path = public, pg_temp;

-- Owner-callable lifecycle entry points: authenticated only (unchanged set).
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.start_live_session(text)',
    'public.pause_live_session()',
    'public.resume_live_session()',
    'public.stop_live_session()',
    'public.resolve_live_session(text, timestamptz)',
    'public.sweep_stale_live_session()',
    'public.send_website_heartbeat()',
    'public.send_extension_heartbeat(text, boolean)',
    'public.clear_live_session_tips()',
    'public.acknowledge_live_session(uuid)',
    'public.set_live_session_coaching_strategy(text)',
    'public.set_live_session_goal_tokens(integer)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- 2. Internal helper: never callable by end users ───────────────────────────
REVOKE EXECUTE ON FUNCTION public._finalize_live_session_metrics(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._finalize_live_session_metrics(uuid) TO service_role;

-- 3. Browser roles: read-only on both tables ─────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.live_sessions       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.live_session_pauses FROM anon, authenticated;

-- Column-level grants survive a table-level REVOKE, so clear them explicitly.
-- One statement per table: every GRANT/REVOKE fires Supabase's DDL event
-- triggers (PostgREST / pg_graphql schema reload), so a per-column loop is slow.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name, string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position) AS cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('live_sessions', 'live_session_pauses')
    GROUP BY table_name
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.%2$I FROM anon, authenticated',
      r.cols, r.table_name
    );
  END LOOP;
END $$;

GRANT SELECT ON public.live_sessions       TO authenticated;
GRANT SELECT ON public.live_session_pauses TO authenticated;

-- 4. Policies ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own live sessions" ON public.live_sessions;
DROP POLICY IF EXISTS "Users read own live sessions"   ON public.live_sessions;
-- Not present in production; present in the staging project from earlier
-- phases. Dropped so no environment keeps a browser write policy.
DROP POLICY IF EXISTS live_sessions_insert_own ON public.live_sessions;
DROP POLICY IF EXISTS live_sessions_update_own ON public.live_sessions;
DROP POLICY IF EXISTS live_sessions_delete_own ON public.live_sessions;
CREATE POLICY "Users read own live sessions" ON public.live_sessions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS live_session_pauses_insert_own ON public.live_session_pauses;
DROP POLICY IF EXISTS live_session_pauses_update_own ON public.live_session_pauses;
-- live_session_pauses_select_own is kept as is.

-- Postconditions: fail the whole migration if any browser write path remains.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s %s %s', g.grantee, g.table_name, g.privilege_type), ', ')
    INTO v_bad
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name IN ('live_sessions', 'live_session_pauses')
      AND g.grantee IN ('anon', 'authenticated')
      AND g.privilege_type <> 'SELECT';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Browser write grants remain: %', v_bad;
  END IF;

  SELECT string_agg(format('%s %s.%s %s', c.grantee, c.table_name, c.column_name, c.privilege_type), ', ')
    INTO v_bad
    FROM information_schema.column_privileges c
    WHERE c.table_schema = 'public'
      AND c.table_name IN ('live_sessions', 'live_session_pauses')
      AND c.grantee IN ('anon', 'authenticated')
      AND c.privilege_type <> 'SELECT';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Browser column write grants remain: %', v_bad;
  END IF;

  IF has_function_privilege('authenticated', 'public._finalize_live_session_metrics(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '_finalize_live_session_metrics is still callable by authenticated';
  END IF;
END $$;

COMMIT;
