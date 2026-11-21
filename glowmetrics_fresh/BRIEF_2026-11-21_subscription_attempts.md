# Brief — 2026-11-21 — Subscription and free-trial attempts

Source: production Supabase (read-only queries). Stripe was not checked because the Stripe connector is not signed in.

## Findings
- No real customer has completed a purchase since 2026-10-09. That date is also the last `checkout.session.completed` webhook.
- 3 real users started 6 Stripe checkouts between 2026-10-23 and 2026-11-10. All are $9.99 monthly except one $99 annual. None completed, and none recorded an error.
  - User `a092227c`: 3 checkouts on 2026-10-23 (monthly, annual, monthly).
  - User `296156a4`: free-trial CTA, then checkout, on 2026-10-28.
  - User `c288680b`: free-trial CTA and checkout on 2026-11-10, then skipped the trial screen, then tried again from Pricing 5 minutes later. That was the most motivated buyer.
- 1 more checkout, on 2026-11-06, came from the owner's own account (a test).
- Funnel: 31 people viewed Pricing, 13 saw the onboarding trial screen, 9 skipped it, 2 started the trial checkout, and 0 converted.

## Data and entitlement issues (approval needed before any change)
1. **2 accounts still have Pro with no Stripe subscription** (`0e1c397a`, `da170dd0`). Their billing period and trial both ended on 2026-10-09 within the same second, which looks like a manual or batch grant. They still get Pro for free, and `profiles.subscription_status='none'` contradicts `subscriptions.status='active'`. Any "active subscriber" metric built on `subscriptions` would overcount by 2.
2. **Cannot yet rule out a broken webhook.** The 6 incomplete checkouts may be abandoned, or someone may have paid without Stripe's webhook reaching us. This needs a check in Stripe.

## New tasks (most important first)
1. Sign in the Stripe connector, or check the Stripe dashboard yourself, for the 6 checkout sessions above and for webhook delivery failures since 2026-10-09.
2. Decide what happens to the 2 free Pro accounts: keep them as comps (and label them), or downgrade them.
3. Look into why the trial checkout is being abandoned (2 for 2), for example price display, the card-required step, or a mobile layout problem.
4. Confirm that the checkout recovery emails (from the merged #808 work) went to these 3 users.

## Completed this chat
- Audited all checkout, subscription, webhook and funnel data for attempts to buy or start a trial.

## In progress
- Earlier GitHub plan decision (from the 2026-11-18 brief), still waiting on you.
