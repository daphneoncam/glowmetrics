-- Live Mode guide: mark profiles.live_mode_guide_sent_at only after delivery.
--
-- Before: this batch set live_mode_guide_sent_at immediately after queuing
-- net.http_post (fire-and-forget), so a failed send was recorded as sent and
-- never retried. Now the Edge Function `send-live-mode-guide-email` sets it
-- after Resend accepts the email; this batch only queues sends and passes the
-- user's id. A failed send is retried on the next daily run while the user is
-- still 2–6 days past signup (at most ~4 attempts). Audience filters are
-- unchanged. Rollback: supabase/rollbacks/20261106_live_mode_guide_mark_on_delivery.rollback.sql
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
      body := jsonb_build_object('email', r.email, 'user_id', r.id)
    );
  end loop;
end;
$function$;
