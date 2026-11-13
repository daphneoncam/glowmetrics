-- Save the full dataset of every import/parse attempt (dashboard upload,
-- onboarding paste and CSV, locked preview), not just the first 500 chars.
--
-- Builds on the live function deployed 2026-11-11 (20260912_add_paste_parse_tracking
-- + paste_parse_log_owner_check, applied directly to production): the
-- owner check (p_user_id must be auth.uid()) is kept exactly.
--
-- Added:
--   raw_bytes / raw_sha256 / raw_truncated : size, fingerprint (dedupe and
--     audit), and whether the 2,000,000-char cap applied.
--   2,000,000-char cap per attempt: one bad or hostile upload cannot fill the
--     database (free plan: 500 MB; DB was 134 MB on 2026-11-13).
--   Retention: pg_cron job deletes attempts older than 90 days.
--   Grants re-stated: authenticated + service_role only (never anon/PUBLIC).
--
-- The stored text contains creators' imported earnings and fan usernames, the
-- same data class as public.tips. RLS: a creator can read only their own
-- rows; writes only through this SECURITY DEFINER function.
-- Rollback: ../rollbacks/20261113_paste_parse_full_dataset.rollback.sql

BEGIN;

ALTER TABLE public.paste_parse_attempts
  ADD COLUMN IF NOT EXISTS raw_bytes integer,
  ADD COLUMN IF NOT EXISTS raw_sha256 text,
  ADD COLUMN IF NOT EXISTS raw_truncated boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_paste_parse_created ON public.paste_parse_attempts (created_at);

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
DECLARE
  v_id uuid;
  c_max constant integer := 2000000;
BEGIN
  -- Only log for the caller's own account (SECURITY DEFINER bypasses RLS).
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;
  INSERT INTO paste_parse_attempts (user_id, source, attempted_platform, claimed_platform, supported,
    raw_text, raw_bytes, raw_sha256, raw_truncated,
    line_count, has_tabs, has_commas, top_shapes, parse_success, error_reason, error_details)
  VALUES (p_user_id, p_source, p_attempted_platform, p_claimed_platform, p_supported,
    left(p_raw_text, c_max),
    octet_length(p_raw_text),
    CASE WHEN p_raw_text IS NULL THEN NULL
         ELSE encode(extensions.digest(convert_to(p_raw_text, 'UTF8'), 'sha256'), 'hex') END,
    coalesce(length(p_raw_text) > c_max, false),
    p_line_count, p_has_tabs, p_has_commas, p_top_shapes, p_parse_success, p_error_reason, p_error_details)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log paste attempt: %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_paste_parse_attempt(uuid, text, text, text, boolean, text, integer, boolean, boolean, text[], boolean, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_paste_parse_attempt(uuid, text, text, text, boolean, text, integer, boolean, boolean, text[], boolean, text, jsonb) TO authenticated, service_role;

-- 90-day retention (idempotent).
DO $retention$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-paste-parse-attempts-90d';
  PERFORM cron.schedule('purge-paste-parse-attempts-90d', '23 3 * * *',
    $job$DELETE FROM public.paste_parse_attempts WHERE created_at < now() - interval '90 days'$job$);
END $retention$;

COMMIT;
