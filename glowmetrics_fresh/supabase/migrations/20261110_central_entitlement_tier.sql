-- Central entitlement tier: ONE rule for who has Pro access.
--
-- Plan: BRIEF_2026-11-06_free-pro-entitlements-plan.md, PR 1 (owner-approved
-- 2026-11-10). Fixes F1 (a Stripe trial gave Free access) and F3 (four
-- different "is Pro" definitions).
--
-- Written against PRODUCTION definitions read 2026-11-10 (pg_get_functiondef):
--   is_live_mode_pro               md5 7b619cf17e854136f3e70660e0b9dc45
--   check_free_tier_platform_limit md5 621e7108525462cb9ed9e62cb9eb0528
--   get_user_insights              md5 f19304ade7ba2a23fcde8a7a209b1310
-- The guard at the top aborts the WHOLE migration (nothing changes) if any of
-- them differs, so a drifted database is never patched blindly.
--
-- The rule (entitlement_tier):
--   plan_expires_at set and passed                          -> free
--   plan = 'unlimited'                                       -> pro
--   plan = 'pro' AND subscription_status = 'active'          -> pro  (paid Stripe)
--   subscription_status = 'trialing' AND trial_ends_at > now -> trial (D1: full Pro)
--   plan = 'pro' AND subscription_status IN ('none','goodwill_trial') or NULL
--                                                            -> pro  (legacy manual /
--                                                               goodwill grant, kept
--                                                               unchanged pending D6)
--   anything else (canceled, past_due, incomplete, unpaid,
--   expired trial, no profile)                               -> free
-- 'trial' grants exactly what 'pro' grants.
--
-- Effect on production on the day this was written: NO account changes access.
-- Every profile is free/none, free/canceled, or the 2 pro/none legacy grants
-- (which stay Pro). The only new access is for future Stripe trials (D1).
-- past_due keeps today's behaviour (the webhook already sets plan='free');
-- the bounded grace period (D4) is PR 2.
--
-- Not changed: the Stripe webhook, the subscriptions table, any row data,
-- RLS policies, Live Mode allowance logic, the 3-platform rule itself.
--
-- ROLLBACK (run as one transaction):
--   CREATE OR REPLACE FUNCTION public.is_live_mode_pro(p_user_id uuid) RETURNS boolean
--     LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
--     SELECT COALESCE((SELECT plan IS NOT NULL AND plan NOT IN ('free')
--        AND (plan_expires_at IS NULL OR plan_expires_at > now())
--        FROM public.profiles WHERE id = p_user_id), false) $f$;
--   -- check_free_tier_platform_limit: identical to section 4 below EXCEPT
--   --   (a) declare also `user_plan text; user_plan_expires_at timestamptz;`
--   --   (b) instead of `if public.is_live_mode_pro(p_user_id) then return; end if;`:
--   --         select plan, plan_expires_at into user_plan, user_plan_expires_at
--   --         from profiles where id = p_user_id;
--   --         if user_plan is not null and user_plan not in ('free')
--   --            and (user_plan_expires_at is null or user_plan_expires_at > now()) then
--   --           return;
--   --         end if;
--   --   (c) message: 'PLATFORM_LIMIT_REACHED: Free tracks up to 3 platforms. Upgrade to Creator Pro ($19.99/mo) to track more.'
--   -- get_user_insights: replace 'v_is_pro := public.is_live_mode_pro(p_user_id);'
--   --   with the original predicate using the same DO-block technique below.
--   DROP FUNCTION IF EXISTS public.get_my_entitlement();
--   DROP FUNCTION IF EXISTS public.entitlement_tier(uuid);

BEGIN;

-- ── 0. Drift guard ─────────────────────────────────────────────────────────
DO $guard$
DECLARE
  v_expected constant jsonb := jsonb_build_object(
    'public.is_live_mode_pro(uuid)',                     '7b619cf17e854136f3e70660e0b9dc45',
    'public.check_free_tier_platform_limit(uuid,text)',  '621e7108525462cb9ed9e62cb9eb0528',
    'public.get_user_insights(uuid,text)',               'f19304ade7ba2a23fcde8a7a209b1310');
  v_sig text;
  v_actual text;
BEGIN
  FOR v_sig IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(pg_get_functiondef(to_regprocedure(v_sig)::oid)) INTO v_actual;
    IF v_actual IS DISTINCT FROM v_expected->>v_sig THEN
      RAISE EXCEPTION 'ENTITLEMENT_MIGRATION_DRIFT: % is not the reviewed definition (md5 %, expected %). Nothing was changed.',
        v_sig, coalesce(v_actual, 'missing'), v_expected->>v_sig;
    END IF;
  END LOOP;
END
$guard$;

-- ── 1. The one rule ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.entitlement_tier(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.plan_expires_at IS NOT NULL AND p.plan_expires_at <= now() THEN 'free'
      WHEN p.plan = 'unlimited' THEN 'pro'
      WHEN p.plan = 'pro' AND p.subscription_status = 'active' THEN 'pro'
      WHEN p.subscription_status = 'trialing' AND p.trial_ends_at > now() THEN 'trial'
      WHEN p.plan = 'pro' AND COALESCE(p.subscription_status, 'none') IN ('none', 'goodwill_trial') THEN 'pro'
      ELSE 'free'
    END
    FROM public.profiles p
    WHERE p.id = p_user_id
  ), 'free')
$$;
-- Takes any user id, so it is server-only (same grants as is_live_mode_pro).
REVOKE ALL ON FUNCTION public.entitlement_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_tier(uuid) TO service_role;

-- ── 2. Caller-scoped read for the app (no user id accepted) ───────────────
CREATE OR REPLACE FUNCTION public.get_my_entitlement()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_tier text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  v_tier := public.entitlement_tier(v_uid);
  RETURN jsonb_build_object(
    'tier', v_tier,
    'trial_ends_at', CASE WHEN v_tier = 'trial'
                          THEN (SELECT trial_ends_at FROM public.profiles WHERE id = v_uid)
                     END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_entitlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_entitlement() TO authenticated, service_role;

-- ── 3. Existing Pro check now delegates (no competing rule) ───────────────
-- CREATE OR REPLACE keeps the existing grants (service_role only).
CREATE OR REPLACE FUNCTION public.is_live_mode_pro(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.entitlement_tier(p_user_id) IN ('pro', 'trial')
$$;

-- ── 4. Platform check: same rule; corrected price copy (F6) ───────────────
-- Body is production's, with the inline plan test replaced by
-- is_live_mode_pro() and the "$19.99/mo" message corrected. The 3-platform
-- limit itself is unchanged (it changes in PR 4).
CREATE OR REPLACE FUNCTION public.check_free_tier_platform_limit(p_user_id uuid, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  existing_platform_count int;
  already_tracked boolean;
  incoming_platform text;
begin
  if p_user_id is distinct from auth.uid() then
    return;
  end if;

  if p_platform is null or p_platform = '' then
    return;
  end if;

  if public.is_live_mode_pro(p_user_id) then
    return;
  end if;

  incoming_platform := public.canonical_platform(p_platform);

  select count(distinct platform), bool_or(platform = incoming_platform)
  into existing_platform_count, already_tracked
  from (
    select public.canonical_platform(platform) as platform from tips where user_id = p_user_id
    union
    select public.canonical_platform(platform) as platform from live_tips where user_id = p_user_id
    union
    select public.canonical_platform(platform) as platform from paid_sessions where user_id = p_user_id
  ) p where platform in ('Chaturbate','BongaCams','MyFreeCams','Stripchat');

  if existing_platform_count >= 3 and not coalesce(already_tracked, false) then
    raise exception 'PLATFORM_LIMIT_REACHED: Free tracks up to 3 platforms. Upgrade to CamCash Pro to track more.'
      using errcode = 'P0001';
  end if;
end;
$function$;

-- ── 5. get_user_insights: swap ONLY its inline Pro predicate ──────────────
-- The function is ~22 KB; rather than hand-copy it, its live definition is
-- edited in place: the exact predicate below must occur exactly once, or the
-- migration aborts. Everything else in the function is byte-for-byte kept.
-- (v_plan / v_plan_expires_at are still selected; they are now unused.)
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.get_user_insights(uuid,text)'::regprocedure);
  v_old constant text := E'v_is_pro := v_plan IS NOT NULL AND v_plan <> ''free''\n    AND (v_plan_expires_at IS NULL OR v_plan_expires_at > NOW());';
  v_new constant text := 'v_is_pro := public.is_live_mode_pro(p_user_id);';
  v_hits int;
BEGIN
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ENTITLEMENT_MIGRATION_DRIFT: get_user_insights Pro predicate found % times (expected 1). Nothing was changed.', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);  -- CREATE OR REPLACE: grants/owner kept
END
$patch$;

COMMIT;
