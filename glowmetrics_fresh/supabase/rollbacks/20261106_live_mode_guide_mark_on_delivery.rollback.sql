-- Restores the pre-20261106 send_live_mode_guide_batch (marks sent on queue).
create or replace function public.send_live_mode_guide_batch()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      body := jsonb_build_object('email', r.email)
    );
    update public.profiles set live_mode_guide_sent_at = now() where id = r.id;
  end loop;
end;
$function$;
