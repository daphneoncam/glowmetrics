-- Promo codes: make the existing redeem_promo_code() safe, and actually end
-- promo Pro when it runs out.
--
-- The tables (promo_codes, promo_code_redemptions) and redeem_promo_code()
-- already existed; the website just never called it. Two problems fixed here:
--  1. A paying subscriber (or a permanent/manual Pro account) could redeem a
--     code, which stamped plan_expires_at on their profile. is_live_mode_pro,
--     get_user_insights and check_free_tier_platform_limit treat an expired
--     plan_expires_at as not Pro, so they would lose Pro while still paying.
--     They are now refused with 'already_pro'.
--  2. Nothing ever ended a promo: plan stayed 'pro' forever on the dashboard.
--     expire_promo_plans() now runs hourly (pg_cron) and returns expired promo
--     Pro to Free. It never touches anyone with a live subscription, and it
--     clears a leftover promo end date from anyone who has since subscribed.
-- Everything else in redeem_promo_code() is unchanged (one promo per user,
-- code limits, extending an unexpired promo).
-- Rollback: supabase/rollbacks/20261111_promo_redeem_safety.rollback.sql

CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id       uuid := auth.uid();
  v_code          text := upper(trim(p_code));
  v_promo         public.promo_codes%ROWTYPE;
  v_current_plan  text;
  v_current_exp   timestamptz;
  v_sub_status    text;
  v_base          timestamptz;
  v_new_expires   timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  IF EXISTS (SELECT 1 FROM public.promo_code_redemptions WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  SELECT * INTO v_promo FROM public.promo_codes WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  IF NOT v_promo.active THEN
    RAISE EXCEPTION 'inactive_code';
  END IF;

  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at < now() THEN
    RAISE EXCEPTION 'expired_code';
  END IF;

  IF v_promo.max_redemptions IS NOT NULL AND v_promo.redemption_count >= v_promo.max_redemptions THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  SELECT plan, plan_expires_at, subscription_status
    INTO v_current_plan, v_current_exp, v_sub_status
  FROM public.profiles WHERE id = v_user_id
  FOR UPDATE;

  -- New: paying / card-trial subscribers and permanent Pro accounts already
  -- have Pro; a promo end date on them would later switch Pro off.
  IF coalesce(v_sub_status, 'none') IN ('active', 'trialing', 'past_due')
     OR v_current_plan = 'unlimited'
     OR (v_current_plan = 'pro' AND v_current_exp IS NULL) THEN
    RAISE EXCEPTION 'already_pro';
  END IF;

  -- Extend from the user's existing expiry if they're already on an
  -- unexpired promo; otherwise start the free period from now.
  v_base := CASE
    WHEN v_current_plan = 'pro' AND v_current_exp IS NOT NULL AND v_current_exp > now()
      THEN v_current_exp
    ELSE now()
  END;
  v_new_expires := v_base + make_interval(days => v_promo.duration_days);

  UPDATE public.profiles
  SET plan = 'pro', plan_expires_at = v_new_expires, plan_expiry_notified_at = NULL
  WHERE id = v_user_id;

  UPDATE public.promo_codes
  SET redemption_count = redemption_count + 1
  WHERE code = v_code;

  INSERT INTO public.promo_code_redemptions (code, user_id) VALUES (v_code, v_user_id);

  RETURN jsonb_build_object('plan_expires_at', v_new_expires, 'duration_days', v_promo.duration_days);
END;
$function$;

-- Hourly: end expired promo Pro. Only rows with a promo end date are touched;
-- anyone with a live subscription is never downgraded.
CREATE OR REPLACE FUNCTION public.expire_promo_plans()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_downgraded int;
  v_cleared int;
BEGIN
  -- Subscribed after redeeming: their Pro now comes from the subscription, so
  -- the old promo end date must not switch Pro features off.
  UPDATE public.profiles
  SET plan_expires_at = NULL
  WHERE plan_expires_at IS NOT NULL
    AND coalesce(subscription_status, 'none') IN ('active', 'trialing', 'past_due');
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  UPDATE public.profiles
  SET plan = 'free', plan_expires_at = NULL
  WHERE plan = 'pro'
    AND plan_expires_at IS NOT NULL
    AND plan_expires_at <= now()
    AND coalesce(subscription_status, 'none') NOT IN ('active', 'trialing', 'past_due');
  GET DIAGNOSTICS v_downgraded = ROW_COUNT;

  RETURN jsonb_build_object('downgraded', v_downgraded, 'cleared_for_subscribers', v_cleared);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_promo_plans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_promo_plans() TO service_role;

SELECT cron.schedule('expire-promo-plans', '17 * * * *', $$SELECT public.expire_promo_plans();$$);
