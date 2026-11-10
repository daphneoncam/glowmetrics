-- 2026-11-10: Free plan limit reduced from 3 to 2 platforms (owner decision).
-- Replaces enforce_free_tier_platform_limit() from 20261013 with limit = 2.
-- NOT applied to any database by this change; review and apply deliberately.
-- Rollback: re-apply supabase/migrations/20261013_platform_limit_trigger_fast_path.sql
-- Free-tier platform-limit trigger: fast path for already-tracked platforms.
--
-- Problem (production, found 2026-10-09): enforce_free_tier_platform_limit()
-- runs BEFORE INSERT FOR EACH ROW on tips and, for every free-plan row,
-- counted distinct platforms across ALL of the user's tips and live_tips.
-- Per-row cost grew with the user's history, so a CSV import's cost grew
-- roughly quadratically: a 12,500-row free-tier import slowed from ~0.5s to
-- ~2.5s per 250-row batch and hit the 60s /api/upload timeout after 9,750
-- rows, leaving a partial import.
--
-- Fix: same rule, cheaper question first. Entitlement behaviour is unchanged:
--   1. Paid plan → allow (unchanged).
--   2. Free (or no profile) and the incoming platform already exists for the
--      user in tips OR live_tips (case-insensitive, as before) → allow. This
--      is one index probe and covers practically every imported row.
--   3. Otherwise count the user's existing distinct platforms (as before) and
--      reject when the user already has free_platform_limit (3) of them.
-- Old rule: reject iff count >= 3 AND NOT already_tracked. Step 2 is exactly
-- the already_tracked case, so allow/reject outcomes are identical.
--
-- Platform values are not normalized in production ('Chaturbate' and
-- 'chaturbate' both exist), so the indexes are on lower(platform) to match
-- the trigger's case-insensitive comparison.
--
-- The only other change is the stale price in the exception text
-- ($19.99 → $9.99). The PLATFORM_LIMIT_REACHED prefix the API routes match
-- on is unchanged, and users see lib/planLimits.js platformLimitMessage(),
-- not this text.
--
-- Rollback: supabase/rollbacks/20261013_platform_limit_trigger_fast_path.rollback.sql

create index if not exists idx_tips_user_platform_lower
  on public.tips (user_id, lower(platform));

create index if not exists idx_live_tips_user_platform_lower
  on public.live_tips (user_id, lower(platform));

create or replace function public.enforce_free_tier_platform_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_plan text;
  existing_platform_count int;
  free_platform_limit constant int := 2;
begin
  if new.platform is null or new.platform = '' then
    return new;
  end if;

  select plan into user_plan from profiles where id = new.user_id;

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
    raise exception 'PLATFORM_LIMIT_REACHED: Free tier tracks up to 2 platforms. Upgrade to Standard ($9.99/mo) for additional platform coverage.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
