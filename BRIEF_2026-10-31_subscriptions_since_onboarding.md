# Brief — 2026-10-31: New subscriptions since the onboarding update

**Baseline:** PR #698, "Onboarding redesign Steps 1–5", merged 2026-10-28 21:23 UTC (14:23 PT).
**Source:** production Supabase (`hlsdlaibnayzbfflxclj`). Every query was read-only. Nothing was edited.

## Answer
**There have been 0 new paid or trial subscriptions since the update.**
- New signups: 4. All 4 are `free`, with no Stripe subscription.
- `subscription_events`, `webhook_events`, `checkout_events`, `free_trial_events`: 0 rows since the merge. The last Stripe webhook arrived on Oct 13.
- The 4 `trial_checkout_created` rows from Oct 28 17:04 UTC came about 4h before the merge, so they are probably pre-merge testing.
- Onboarding funnel since the merge: 3 users started -> 1 finished the import -> 1 reached the trial screen -> 0 checkouts.

## Issues found (most important first)
1. **Onboarding import is failing.** There were 7 `onboarding_paste_parse_failed` events across 2 of the 3 new users. Only 1 user got through the import. This is likely blocking conversions.
2. **Stale "active" subscriptions.** 2 rows in `subscriptions` are `active` (`standard_monthly`). Their `current_period_end` is 2026-10-09, which has already passed, and they have no Stripe subscription id. The matching profiles say `plan=pro` but `subscription_status=none`. Anything that counts "active subscribers" from `subscriptions` may be overstated, and these 2 users may still have Pro access. I have not changed them. I need your approval and to know whether they are comped or test accounts.
3. **The two status fields disagree.** `subscriptions.status` uses free/active/canceled, while `profiles.subscription_status` uses none/canceled. They do not match for the 2 rows above.
4. **Stripe cross-check not possible.** The Stripe connector isn't authorized in this session, so Stripe itself was not checked directly.
5. **Deploy time not confirmed.** I used the merge time as the baseline. The actual Vercel production deploy time was not checked.
6. Info only: canceled row d23fb43a... was updated at 2026-10-28 21:54 UTC, after the merge. It is not a new subscription. The update was probably a sync or cron job.

## Tasks
**New (by priority)**
1. Investigate the `onboarding_paste_parse_failed` errors in the Step 2 import.
2. Decide what to do with the 2 stale `active` subscriptions (comped, test, or should be expired).
3. Authorize Stripe so the data can be checked against Stripe directly.
4. Confirm the production deploy time of #698.

**Completed**
- Counted subscriptions, checkouts, trials, webhooks and the onboarding funnel since #698.

**In progress**
- None.
