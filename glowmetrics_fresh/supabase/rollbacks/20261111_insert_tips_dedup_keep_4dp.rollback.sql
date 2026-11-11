-- Rollback: insert_tips_dedup back to 2 decimals
--
-- PROPOSED — NOT APPLIED. Lives in supabase/proposed/ so no deploy step picks
-- it up. Apply only with explicit owner approval, on a backup branch first.
--
-- Rollback for supabase/proposed/20261111_insert_tips_dedup_keep_4dp.sql:
-- restores the live 2026-11-01 body (stored value round(..., 2)). Rows inserted
-- while the 4-dp body was live keep their 4-dp values; their usd_rounded and
-- dedup keys are identical either way.
--
-- Fingerprints are md5(prosrc) with carriage returns removed, so they do not
-- depend on CRLF vs LF line endings (production stores CRLF).
--   live body before this change: f857f3f7619fc789c2a617487a7a132f
--   body after this change:       697af8bff40087433588302799d1d03e
-- The preflight refuses to run unless the live body is exactly f857f3f7…
-- (or already 697af8bf…, a safe re-run).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE v text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v FROM pg_proc
   WHERE oid = 'public.insert_tips_dedup(jsonb, uuid)'::regprocedure;
  IF v IS DISTINCT FROM 'f857f3f7619fc789c2a617487a7a132f' AND v IS DISTINCT FROM '697af8bff40087433588302799d1d03e' THEN
    RAISE EXCEPTION 'Preflight failed: insert_tips_dedup body (md5 %) is not the expected live body. Rebase this file first.', v;
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.insert_tips_dedup(tips jsonb, p_upload_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count int := 0;
  total_input    int := 0;
BEGIN
  SELECT jsonb_array_length(tips) INTO total_input;

  IF auth.role() = 'authenticated' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(tips) AS row_data
    WHERE (row_data->>'user_id')::uuid IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'RLS violation: user_id mismatch' USING errcode = '28000';
  END IF;

  -- Import ownership: a tip may only be linked to an import record owned by
  -- the same creator as the tip. A missing import (owner NULL) is rejected too.
  -- Applies to every role, including service_role.
  IF p_upload_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(tips) AS row_data
    WHERE (row_data->>'user_id')::uuid IS DISTINCT FROM
          (SELECT u.user_id FROM public.csv_uploads u WHERE u.id = p_upload_id)
  ) THEN
    RAISE EXCEPTION 'Import ownership violation: upload_id does not belong to the earnings owner' USING errcode = '28000';
  END IF;

  WITH incoming AS (
    SELECT
      (row_data->>'user_id')::uuid AS user_id,
      (row_data->>'date_time')::timestamptz AS date_time,
      COALESCE(NULLIF(row_data->>'platform', ''), 'Unknown') AS platform,
      row_data->>'username' AS username,
      COALESCE(NULLIF(row_data->>'tip_type', ''), 'Tip') AS tip_type,
      CASE
        WHEN (row_data->>'tokens') IS NOT NULL AND (row_data->>'tokens') != ''
        THEN (row_data->>'tokens')::numeric::int
        ELSE round(COALESCE((row_data->>'usd')::numeric, 0) /
          (CASE WHEN COALESCE(NULLIF(row_data->>'platform', ''), 'Unknown') = 'BongaCams' THEN 0.025 ELSE 0.05 END)
        )::int
      END AS tokens,
      round(CASE
        WHEN (row_data->>'usd') IS NOT NULL AND (row_data->>'usd') != ''
        THEN (row_data->>'usd')::numeric
        ELSE COALESCE((row_data->>'tokens')::numeric, 0) *
          (CASE WHEN COALESCE(NULLIF(row_data->>'platform', ''), 'Unknown') = 'BongaCams' THEN 0.025 ELSE 0.05 END)
      END, 2) AS usd,
      COALESCE(row_data->>'tip_note', '') AS tip_note,
      p_upload_id AS upload_id,
      NULLIF(row_data->>'tip_seq', '')::int AS client_seq,
      ROW_NUMBER() OVER (
        PARTITION BY
          (row_data->>'user_id')::uuid,
          lower(row_data->>'username'),
          CASE
            WHEN (row_data->>'tokens') IS NOT NULL AND (row_data->>'tokens') != ''
            THEN (row_data->>'tokens')::numeric::int
            ELSE round(COALESCE((row_data->>'usd')::numeric, 0) /
              (CASE WHEN COALESCE(NULLIF(row_data->>'platform', ''), 'Unknown') = 'BongaCams' THEN 0.025 ELSE 0.05 END)
            )::int
          END,
          round(CASE
            WHEN (row_data->>'usd') IS NOT NULL AND (row_data->>'usd') != ''
            THEN (row_data->>'usd')::numeric
            ELSE COALESCE((row_data->>'tokens')::numeric, 0) *
              (CASE WHEN COALESCE(NULLIF(row_data->>'platform', ''), 'Unknown') = 'BongaCams' THEN 0.025 ELSE 0.05 END)
          END, 2),
          (row_data->>'date_time')::timestamptz
        ORDER BY ordinality
      ) AS batch_seq
    FROM jsonb_array_elements(tips) WITH ORDINALITY AS t(row_data, ordinality)
    WHERE (row_data->>'user_id')   IS NOT NULL
      AND (row_data->>'date_time') IS NOT NULL
      AND (row_data->>'username')  IS NOT NULL
      AND (row_data->>'username')  != ''
      AND (
        ((row_data->>'tokens') IS NOT NULL AND (row_data->>'tokens') != '' AND (row_data->>'tokens')::numeric > 0)
        OR
        ((row_data->>'usd') IS NOT NULL AND (row_data->>'usd') != '' AND (row_data->>'usd')::numeric > 0)
      )
  ),
  result AS (
    INSERT INTO public.tips (
      user_id, date_time, platform, username, tip_type, tokens, usd, tip_note, upload_id, tip_seq
    )
    SELECT user_id, date_time, platform, username, tip_type, tokens, usd, tip_note, upload_id,
      COALESCE(client_seq, batch_seq) AS tip_seq
    FROM incoming
    ON CONFLICT (user_id, username_lower, tokens, usd_rounded, date_time, tip_seq)
    DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO inserted_count FROM result;

  RETURN jsonb_build_object(
    'inserted', inserted_count,
    'skipped',  total_input - inserted_count,
    'total',    total_input
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object(
    'error',    SQLERRM,
    'detail',   SQLSTATE,
    'inserted', 0,
    'skipped',  0
  );
END;
$function$;

-- Grants unchanged (identical to 20261101_harden_dedup_rpc_grants.sql).
REVOKE ALL ON FUNCTION public.insert_tips_dedup(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_tips_dedup(jsonb, uuid) TO authenticated, service_role;

DO $postflight$
DECLARE v text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v FROM pg_proc
   WHERE oid = 'public.insert_tips_dedup(jsonb, uuid)'::regprocedure;
  IF v IS DISTINCT FROM '697af8bff40087433588302799d1d03e' THEN
    RAISE EXCEPTION 'Postflight failed: body md5 % is not the intended result.', v;
  END IF;
END $postflight$;

COMMIT;
