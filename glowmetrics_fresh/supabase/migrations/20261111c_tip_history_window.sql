-- Server-side history window for tips.
--
-- Trial users see only the last 31 days in their own timezone; legacy and paid
-- users see everything; every other state sees nothing. The window only
-- restricts reads. No row is deleted, changed, or moved.
--
-- Replaces tips_own_select (auth.uid() = user_id) with the same owner check
-- plus the visibility function. Insert and delete policies are unchanged.
-- The studio read policy is unchanged (separate policy, not owner-scoped).
--
-- Scope: tips only. live_tips and other history tables are a follow-up
-- migration and are NOT changed here.

begin;

create or replace function public.tip_history_visible(p_user uuid, p_when timestamptz)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p.access_state in ('legacy', 'paid_monthly', 'paid_annual') then true
    when p.access_state = 'trial' then
      p_when >= (
        (date_trunc('day', now() at time zone coalesce(p.timezone, 'UTC')) - interval '30 days')
        at time zone coalesce(p.timezone, 'UTC')
      )
    else false
  end
  from public.profiles p
  where p.id = p_user
$$;

revoke all on function public.tip_history_visible(uuid, timestamptz) from public;
grant execute on function public.tip_history_visible(uuid, timestamptz) to authenticated;

drop policy if exists tips_own_select on public.tips;
create policy tips_own_select on public.tips
  for select
  using (auth.uid() = user_id and public.tip_history_visible(user_id, date_time));

commit;
