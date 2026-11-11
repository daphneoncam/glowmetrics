-- Platform limit: trial and paid accounts are not capped; only legacy free
-- accounts keep the 3-platform cap. Body is the 20261013 definition with one
-- change: access_state is checked, so a trial (stored as plan 'free') is not
-- blocked by the cap. Error prefix PLATFORM_LIMIT_REACHED is unchanged so
-- existing API routes still match it.

begin;

create or replace function public.enforce_free_tier_platform_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  user_plan text;
  user_access text;
  existing_platform_count int;
  free_platform_limit constant int := 3;
begin
  if new.platform is null or new.platform = '' then
    return new;
  end if;

  select plan, access_state into user_plan, user_access from profiles where id = new.user_id;

  -- Trial and paid entitlements (server-owned) have no platform limit.
  if user_access in ('trial', 'paid_monthly', 'paid_annual') then
    return new;
  end if;

  -- Paid plans (pro/unlimited) have no platform limit.
  if user_plan is not null and user_plan not in ('free') then
    return new;
  end if;

  -- Fast path: platform already tracked for this user → never blocked.
  if exists (
       select 1 from tips
        where user_id = new.user_id and lower(platform) = lower(new.platform))
     or exists (
       select 1 from live_tips
        where user_id = new.user_id and lower(platform) = lower(new.platform))
  then
    return new;
  end if;

  -- Genuinely new platform: same count as before.
  select count(distinct platform)
  into existing_platform_count
  from (
    select lower(platform) as platform from tips where user_id = new.user_id
    union
    select lower(platform) as platform from live_tips where user_id = new.user_id
  ) p;

  if existing_platform_count >= free_platform_limit then
    raise exception 'PLATFORM_LIMIT_REACHED: Free tier tracks up to 3 platforms. Upgrade to Standard ($9.99/mo) for additional platform coverage.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

commit;
