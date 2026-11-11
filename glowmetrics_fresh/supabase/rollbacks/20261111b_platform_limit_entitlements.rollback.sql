-- Restores the 20261013 platform-limit trigger function (plan-only check).
begin;
create or replace function public.enforce_free_tier_platform_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  user_plan text;
  existing_platform_count int;
  free_platform_limit constant int := 3;
begin
  if new.platform is null or new.platform = '' then
    return new;
  end if;
  select plan into user_plan from profiles where id = new.user_id;
  if user_plan is not null and user_plan not in ('free') then
    return new;
  end if;
  if exists (select 1 from tips where user_id = new.user_id and lower(platform) = lower(new.platform))
     or exists (select 1 from live_tips where user_id = new.user_id and lower(platform) = lower(new.platform)) then
    return new;
  end if;
  select count(distinct platform) into existing_platform_count
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
