-- Entitlement state: server-owned access state, separate from profiles.plan.
--
-- Decisions (approved 2026-11-11):
--   * `legacy`   accounts created before the cutoff keep current behaviour
--                (grandfathered, not a Free tier, not moved to trial or paid).
--   * `trial`    valid Stripe trial: all platforms, rolling 31-day history.
--   * `paid_*`   monthly / annual: identical entitlements, full history.
--   * `none`     no access (new accounts until checkout is verified).
--
-- Written only by the Stripe webhook (service role). The browser has no write
-- privileges on these columns: the profiles column grant (migration 20261010)
-- lists only the app's own columns, so these are not browser-writable.
--
-- No tip data is changed. Only nullable/defaulted columns are added and
-- legacy accounts are labelled.

begin;

alter table public.profiles
  add column if not exists access_state text not null default 'none'
    check (access_state in ('legacy', 'trial', 'paid_monthly', 'paid_annual', 'past_due', 'canceled', 'expired', 'none')),
  add column if not exists access_state_updated_at timestamptz,
  add column if not exists paid_through timestamptz,
  add column if not exists billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year'));

-- Accounts created before the cutoff are grandfathered. Only rows still at the
-- default are labelled, so re-running this never overwrites a later state.
update public.profiles
   set access_state = 'legacy',
       access_state_updated_at = now()
 where created_at < timestamptz '2026-11-11 00:00:00+00'
   and access_state = 'none';

commit;
