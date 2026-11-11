-- Staging functions + triggers, from production definitions (read-only, 2026-11-11).
-- Omitted on purpose (outside the Sessions/Platforms/import path):
--   get_user_insights (dashboard handles its failure), enforce_live_active_limit
--   and trg_enforce_live_mode_pro_entitlement (need the Live Mode entitlement
--   chain), welcome_email_trigger (sends email). Studio access is stubbed false.
BEGIN;
CREATE OR REPLACE FUNCTION public.canonical_platform(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when p_value is null then 'Unknown'
    when btrim(p_value) = '' then 'Unknown'
    when lower(btrim(p_value)) in ('chaturbate') then 'Chaturbate'
    when lower(btrim(p_value)) in ('bongacams') then 'BongaCams'
    when lower(btrim(p_value)) in ('myfreecams') then 'MyFreeCams'
    when lower(btrim(p_value)) in ('stripchat') then 'Stripchat'
    when lower(btrim(p_value)) in ('camsoda') then 'CamSoda'
    when lower(btrim(p_value)) = 'cb' then 'Chaturbate'
    when lower(btrim(p_value)) = 'bc' then 'BongaCams'
    when lower(btrim(p_value)) = 'mfc' then 'MyFreeCams'
    when lower(btrim(p_value)) = 'sc' then 'Stripchat'
    when lower(btrim(p_value)) = 'cs' then 'CamSoda'
    when lower(btrim(p_value)) in ('bonga cams','bonga-cams','bongamodels') then 'BongaCams'
    when lower(btrim(p_value)) = 'my free cams' then 'MyFreeCams'
    when lower(btrim(p_value)) = 'strip chat' then 'Stripchat'
    when lower(btrim(p_value)) = 'cam soda' then 'CamSoda'
    when lower(btrim(p_value)) like '%bonga%' then 'BongaCams'
    when lower(btrim(p_value)) like '%chaturbate%' then 'Chaturbate'
    when lower(btrim(p_value)) like '%freecams%' then 'MyFreeCams'
    when lower(btrim(p_value)) like '%stripchat%' then 'Stripchat'
    when lower(btrim(p_value)) like '%camsoda%' then 'CamSoda'
    else btrim(p_value)
  end;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_platform_name(p text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select case lower(btrim(p))
    when 'chaturbate' then 'Chaturbate'
    when 'bongacams'  then 'BongaCams'
    when 'myfreecams' then 'MyFreeCams'
    else nullif(btrim(p), '')
  end
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, plan, trial_days)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'display_name', new.email), 'free', 7);
  INSERT INTO public.subscriptions (id, user_id, plan_type, billing_cycle, is_lifetime_locked,
    current_period_start, current_period_end, created_at, updated_at)
  VALUES (gen_random_uuid(), new.id, 'free', NULL, false, NOW(), NOW() + INTERVAL '30 days', NOW(), NOW());
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_primary_pro_platform()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.primary_pro_platform IS NULL OR btrim(NEW.primary_pro_platform) = '' THEN
    NEW.primary_pro_platform := NULL;
    RETURN NEW;
  END IF;
  NEW.primary_pro_platform := public.canonical_platform(NEW.primary_pro_platform);
  IF NEW.primary_pro_platform = 'Unknown' THEN
    RAISE EXCEPTION 'primary_pro_platform must be a recognised platform, got %', NEW.primary_pro_platform
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_streaming_platforms()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  raw text; canon text; collected text[] := '{}'; known text[];
BEGIN
  IF NEW.streaming_platforms IS NULL THEN RETURN NEW; END IF;
  IF array_length(NEW.streaming_platforms, 1) IS NULL THEN
    NEW.streaming_platforms := NULL; RETURN NEW;
  END IF;
  known := ARRAY[public.canonical_platform('cb'), public.canonical_platform('bc'),
    public.canonical_platform('mfc'), public.canonical_platform('sc'), public.canonical_platform('cs')];
  FOREACH raw IN ARRAY NEW.streaming_platforms LOOP
    CONTINUE WHEN raw IS NULL OR btrim(raw) = '';
    canon := public.canonical_platform(raw);
    CONTINUE WHEN NOT (canon = ANY (known));
    IF NOT (canon = ANY (collected)) THEN collected := array_append(collected, canon); END IF;
  END LOOP;
  NEW.streaming_platforms := CASE WHEN array_length(collected, 1) IS NULL THEN NULL ELSE collected END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_profiles_primary_platform()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.primary_pro_platform IS NOT NULL
     AND NEW.primary_pro_platform IS DISTINCT FROM OLD.primary_pro_platform THEN
    RAISE EXCEPTION 'primary_pro_platform is permanent once chosen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.generate_upload_ref(p_platform text, p_date_from timestamp with time zone)
 RETURNS text LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE prefix text; month_str text; seq int;
BEGIN
  prefix := CASE p_platform WHEN 'BongaCams' THEN 'BC' WHEN 'Chaturbate' THEN 'CB' WHEN 'MyFreeCams' THEN 'MFC' ELSE 'UNK' END;
  month_str := to_char(p_date_from, 'YYYY-MM');
  SELECT COUNT(*) + 1 INTO seq FROM public.csv_uploads
   WHERE platform = p_platform AND to_char(date_from, 'YYYY-MM') = month_str;
  RETURN prefix || '-' || month_str || '-' || lpad(seq::text, 3, '0');
END;
$function$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER normalize_primary_pro_platform_trg BEFORE INSERT OR UPDATE OF primary_pro_platform ON public.profiles FOR EACH ROW EXECUTE FUNCTION normalize_primary_pro_platform();
CREATE TRIGGER normalize_streaming_platforms_trg BEFORE INSERT OR UPDATE OF streaming_platforms ON public.profiles FOR EACH ROW EXECUTE FUNCTION normalize_streaming_platforms();
CREATE TRIGGER zz_guard_profiles_primary_platform BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profiles_primary_platform();
CREATE TRIGGER live_sessions_updated_at BEFORE UPDATE ON public.live_sessions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
COMMIT;
