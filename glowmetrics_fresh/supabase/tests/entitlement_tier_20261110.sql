-- Checks for 20261110_central_entitlement_tier.sql.
-- STAGING / LOCAL ONLY. Every block ends in ROLLBACK: no data is kept.
-- Usage: psql "$STAGING_DB_URL" -v uid=<a test auth.users id> -v other=<another id> -f this_file
-- Every SELECT below must return only `t` (true) values.

-- 1. The rule, one account state at a time (profile edited inside the txn).
select set_config('test.uid', :'uid', false);
begin;
create temp table cases(label text, plan text, status text, trial_ends_at timestamptz, plan_expires_at timestamptz, expected text);
insert into cases values
  ('free, no subscription',            'free', 'none',           null,                     null,                    'free'),
  ('paid Pro',                         'pro',  'active',         null,                     null,                    'pro'),
  ('trial running (D1)',               'free', 'trialing',       now() + interval '3 days', null,                   'trial'),
  ('trial running, plan pro',          'pro',  'trialing',       now() + interval '3 days', null,                   'trial'),
  ('trial ended, webhook not yet run', 'free', 'trialing',       now() - interval '1 hour', null,                   'free'),
  ('trial with no end date',           'free', 'trialing',       null,                     null,                    'free'),
  ('canceled',                         'free', 'canceled',       null,                     null,                    'free'),
  ('canceled but plan still pro',      'pro',  'canceled',       null,                     null,                    'free'),
  ('past_due (grace is PR 2)',         'free', 'past_due',       null,                     null,                    'free'),
  ('past_due, plan still pro',         'pro',  'past_due',       null,                     null,                    'free'),
  ('incomplete',                       'pro',  'incomplete',     null,                     null,                    'free'),
  ('legacy grant (D6, unchanged)',     'pro',  'none',           now() - interval '30 days', null,                  'pro'),
  ('legacy grant, NULL status',        'pro',  null,             null,                     null,                    'pro'),
  ('goodwill grant',                   'pro',  'goodwill_trial', now() + interval '2 days', null,                   'pro'),
  ('grant with future expiry',         'pro',  'none',           null,                     now() + interval '1 day', 'pro'),
  ('grant with passed expiry',         'pro',  'none',           null,                     now() - interval '1 day', 'free'),
  ('paid Pro with passed expiry',      'pro',  'active',         null,                     now() - interval '1 day', 'free'),
  ('unlimited',                        'unlimited', 'none',      null,                     null,                    'pro');
create temp table results(label text, expected text, actual text, live boolean);
do $$
declare c record;
begin
  for c in select * from cases loop
    update public.profiles
       set plan = c.plan, subscription_status = c.status,
           trial_ends_at = c.trial_ends_at, plan_expires_at = c.plan_expires_at
     where id = current_setting('test.uid')::uuid;
    insert into results values (c.label, c.expected,
      public.entitlement_tier(current_setting('test.uid')::uuid),
      public.is_live_mode_pro(current_setting('test.uid')::uuid));
  end loop;
end $$;
select label, expected, actual, (expected = actual) as tier_ok,
       (live = (expected in ('pro','trial'))) as live_mode_agrees
  from results order by tier_ok, label;
rollback;

-- 2. No profile row -> free.
select public.entitlement_tier('00000000-0000-0000-0000-000000000000'::uuid) = 'free' as missing_profile_is_free;

-- 3. Grants: the id-taking function is server-only; the app reads only its own tier.
select not has_function_privilege('authenticated', 'public.entitlement_tier(uuid)', 'execute') as auth_cannot_query_any_user,
       not has_function_privilege('anon', 'public.entitlement_tier(uuid)', 'execute')          as anon_cannot_query_any_user,
       not has_function_privilege('anon', 'public.get_my_entitlement()', 'execute')            as anon_cannot_read_entitlement,
       has_function_privilege('authenticated', 'public.get_my_entitlement()', 'execute')       as auth_can_read_own,
       not has_function_privilege('authenticated', 'public.is_live_mode_pro(uuid)', 'execute') as live_pro_still_server_only;

-- 4. get_my_entitlement answers only for the signed-in caller; logged out is refused.
begin;
update public.profiles set plan = 'free', subscription_status = 'trialing',
       trial_ends_at = now() + interval '5 days', plan_expires_at = null
 where id = :'uid'::uuid;
update public.profiles set plan = 'free', subscription_status = 'none',
       trial_ends_at = null, plan_expires_at = null
 where id = :'other'::uuid;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select (public.get_my_entitlement()->>'tier') = 'trial'          as own_tier_is_trial,
       (public.get_my_entitlement()->>'trial_ends_at') is not null as trial_end_returned;
rollback;

begin;
select set_config('request.jwt.claims', json_build_object('sub', :'other', 'role', 'authenticated')::text, true);
set local role authenticated;
select (public.get_my_entitlement()->>'tier') = 'free'         as other_sees_own_free,
       (public.get_my_entitlement()->'trial_ends_at') = 'null'::jsonb as no_trial_date_for_free;
rollback;

begin;
set local role anon;
select public.get_my_entitlement();  -- must FAIL (permission denied)
rollback;

-- 5. get_user_insights now uses the shared rule (predicate swapped exactly once).
select position('v_is_pro := public.is_live_mode_pro(p_user_id);' in pg_get_functiondef('public.get_user_insights(uuid,text)'::regprocedure)) > 0 as insights_uses_shared_rule,
       position('v_plan <> ''free''' in pg_get_functiondef('public.get_user_insights(uuid,text)'::regprocedure)) = 0 as old_predicate_gone;

-- 6. Platform-limit message no longer quotes the wrong price.
select position('$19.99' in pg_get_functiondef('public.check_free_tier_platform_limit(uuid,text)'::regprocedure)) = 0 as no_wrong_price;
