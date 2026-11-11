-- Restores the previous trigger/batch (no secret header; note the old
-- trigger also sent the full auth.users row). Redeploy the previous Edge
-- Function versions as well, or they will refuse these calls.
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_signup()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://hlsdlaibnayzbfflxclj.supabase.co/functions/v1/send-welcome-email',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('email', NEW.email, 'record', row_to_json(NEW))
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_live_mode_guide_batch()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  for r in
    select u.id, u.email
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.created_at between now() - interval '6 days' and now() - interval '2 days'
      and p.live_mode_guide_sent_at is null
      and u.email !~* '(daphneoncam|daphenoncam)\+'
      and u.email !~* 'polefreaktrial\+'
      and u.email !~* '(^|@)test'
      and u.email !~* 'qa-'
      and u.email !~* '@(camcash|cammcash|camcashgrl|cammcashgrl)(\.com)?$'
      and u.email ~ '@[^@]+\.[a-zA-Z]{2,}$'
  loop
    perform net.http_post(
      url := 'https://hlsdlaibnayzbfflxclj.supabase.co/functions/v1/send-live-mode-guide-email',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('email', r.email, 'user_id', r.id)
    );
  end loop;
end;
$function$;

DROP FUNCTION IF EXISTS public.email_function_headers();
DROP FUNCTION IF EXISTS public.get_email_function_secret();
-- The vault secret 'email_function_secret' is left in place (harmless).
