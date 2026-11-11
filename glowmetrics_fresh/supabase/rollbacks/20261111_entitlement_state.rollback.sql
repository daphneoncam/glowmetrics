-- Removes the entitlement columns. Only the new state columns are dropped;
-- no tip, upload, or profile data is touched.
begin;
alter table public.profiles
  drop column if exists access_state,
  drop column if exists access_state_updated_at,
  drop column if exists paid_through,
  drop column if exists billing_interval;
commit;
