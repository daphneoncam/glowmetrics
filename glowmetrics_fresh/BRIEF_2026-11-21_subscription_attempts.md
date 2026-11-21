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

## Investigation: why nobody converted (follow-up in the same chat)
Read-only evidence from the code and the event timelines:
1. **The "free" trial needs a card, and the trial screen doesn't say so.** `app/api/stripe/checkout/route.js` collects a card on the Stripe page (`trial_period_days: 7`). The onboarding screen shows "$0 today · 7 days free · then $9.99/month" with no mention of a card. User `c288680b` reached Stripe at 12:06:27, and 10 seconds later was back on the onboarding screen choosing Free, which means they used the browser Back button. This fits the idea that the card form surprised them, but it is not proven yet.
2. **Abandoned checkouts are invisible to us.** Nothing reads `/dashboard?canceled=true` (the `cancel_url`), and no webhook handles `checkout.session.expired`. Every checkout stays `checkout_created` forever, so we can't see why or when people leave.
3. **Metric accuracy: `onboarding_trial_skipped` overcounts.** Someone who goes to Stripe and then presses Back is counted as both "trial started" and "trial skipped" (that happened with `c288680b`). The "9 skipped" figure includes at least 1 person who tried the trial.
4. **Tracking gap:** user `a092227c` created 3 checkouts on 2026-10-23 (monthly, then annual, then monthly) with no analytics events at all that day. Whatever page they used has no tracking.
5. **Preview URL in use:** user `296156a4` signed up and checked out on a Vercel preview URL (`glowmetrics-ggsb-jke8psu9i-...vercel.app`) that writes to the production database. I couldn't check which Stripe key previews use, because the Vercel API returned 403. If it's a test key, that checkout could never have been a real sale.
6. **Little value shown before the ask:** `c288680b` imported only 1 tip (one paste failed), and their first insight came back empty before they were asked to pay.

## New tasks (most important first)
0. Check in Stripe (dashboard or connector), for the 7 sessions: open/expired/complete, whether a card was entered, any declines or 3DS failures, and live vs test mode. This one check settles most of the questions above.
0b. Approval needed: add tracking for checkout cancels and expiries, and fix the `trial_skipped` double count. No code has been changed.
0c. Decision for you: whether the trial screen should say "card required, $0 today."
1. Sign in the Stripe connector, or check the Stripe dashboard yourself, for the 6 checkout sessions above and for webhook delivery failures since 2026-10-09.
2. Decide what happens to the 2 free Pro accounts: keep them as comps (and label them), or downgrade them.
3. Look into why the trial checkout is being abandoned (2 for 2), for example price display, the card-required step, or a mobile layout problem.
4. Confirm that the checkout recovery emails (from the merged #808 work) went to these 3 users.

## Completed this chat
- Audited all checkout, subscription, webhook and funnel data for attempts to buy or start a trial.

## In progress
- Earlier GitHub plan decision (from the 2026-11-18 brief), still waiting on you.
