-- Restores redeem_promo_code() as it was before 20261111 and removes the
-- hourly promo expiry. Does not change any profile rows.
SELECT cron.unschedule('expire-promo-plans');
DROP FUNCTION IF EXISTS public.expire_promo_plans();

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

  SELECT plan, plan_expires_at INTO v_current_plan, v_current_exp
  FROM public.profiles WHERE id = v_user_id;

  v_base := CASE
    WHEN v_current_plan IN ('pro', 'unlimited') AND v_current_exp IS NOT NULL AND v_current_exp > now()
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
