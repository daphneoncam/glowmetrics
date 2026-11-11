-- Lock the email Edge Functions (send-welcome-email, send-live-mode-guide-email,
-- send-pro-trial-email). They had verify_jwt off and no other check, so anyone
-- who knew the URL could make them email any address.
--
-- A random secret is kept in Supabase Vault. The database functions that call
-- the Edge Functions send it in an `x-camcash-secret` header; the Edge
-- Functions read the same secret through get_email_function_secret() (service
-- role only) and refuse calls without it.
--
-- Also: the signup trigger sent the whole auth.users row (including the
-- password hash) to the welcome function. It now sends only the email.
-- Rollback: supabase/rollbacks/20261111_lock_email_functions.rollback.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_function_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'email_function_secret',
      'Shared secret between the database and the email Edge Functions'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_email_function_secret()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_function_secret' LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.get_email_function_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_function_secret() TO service_role;

CREATE OR REPLACE FUNCTION public.email_function_headers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'x-camcash-secret', coalesce(public.get_email_function_secret(), '')
  );
$function$;
REVOKE ALL ON FUNCTION public.email_function_headers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_welcome_email_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://hlsdlaibnayzbfflxclj.supabase.co/functions/v1/send-welcome-email',
    headers := public.email_function_headers(),
    body := jsonb_build_object('email', NEW.email)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_live_mode_guide_batch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      headers := public.email_function_headers(),
      body := jsonb_build_object('email', r.email, 'user_id', r.id)
    );
  end loop;
end;
$function$;
