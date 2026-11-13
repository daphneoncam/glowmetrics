-- Rollback for 20261113_paste_parse_full_dataset.sql: restores the live
-- 2026-11-11 function body (owner check, no size cap/fingerprint), removes
-- the retention job, the index and the three added columns (their data is
-- dropped; raw_text itself is kept).
BEGIN;

DO $r$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-paste-parse-attempts-90d';
END $r$;

CREATE OR REPLACE FUNCTION public.log_paste_parse_attempt(
  p_user_id uuid, p_source text, p_attempted_platform text,
  p_claimed_platform text DEFAULT NULL::text, p_supported boolean DEFAULT false,
  p_raw_text text DEFAULT NULL::text, p_line_count integer DEFAULT NULL::integer,
  p_has_tabs boolean DEFAULT NULL::boolean, p_has_commas boolean DEFAULT NULL::boolean,
  p_top_shapes text[] DEFAULT NULL::text[], p_parse_success boolean DEFAULT false,
  p_error_reason text DEFAULT NULL::text, p_error_details jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID;
BEGIN
  -- Only log for the caller's own account (SECURITY DEFINER bypasses RLS).
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;
  INSERT INTO paste_parse_attempts (user_id, source, attempted_platform, claimed_platform, supported,
    raw_text, line_count, has_tabs, has_commas, top_shapes, parse_success, error_reason, error_details)
  VALUES (p_user_id, p_source, p_attempted_platform, p_claimed_platform, p_supported,
    p_raw_text, p_line_count, p_has_tabs, p_has_commas, p_top_shapes, p_parse_success, p_error_reason, p_error_details)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log paste attempt: %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_paste_parse_attempt(uuid, text, text, text, boolean, text, integer, boolean, boolean, text[], boolean, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_paste_parse_attempt(uuid, text, text, text, boolean, text, integer, boolean, boolean, text[], boolean, text, jsonb) TO authenticated, service_role;

DROP INDEX IF EXISTS public.idx_paste_parse_created;
ALTER TABLE public.paste_parse_attempts
  DROP COLUMN IF EXISTS raw_bytes,
  DROP COLUMN IF EXISTS raw_sha256,
  DROP COLUMN IF EXISTS raw_truncated;

COMMIT;
