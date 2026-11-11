-- Restores the original tips SELECT policy and removes the visibility function.
-- No tip rows are touched.
begin;
drop policy if exists tips_own_select on public.tips;
create policy tips_own_select on public.tips for select using (auth.uid() = user_id);
drop function if exists public.tip_history_visible(uuid, timestamptz);
commit;
