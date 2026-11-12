-- SUBSCRIPTION SYNC FIX: daphnes@camcash.com
-- Date: Sept 13, 2026
-- Issue: Stripe subscription ID never synced from webhook
-- Impact: Subscription shows as 'free' but should be 'active'
--
-- User Details:
-- - Username: daphnes@camcash.com
-- - User ID: c500c661-bf1d-4862-8bca-72df389dd378
-- - Stripe Customer ID: cus_VEQprrXTfPwvGp (EXISTS ✓)
-- - Stripe Subscription ID: sub_1UDxyhGnNbF6OYVRCTb5up2M (FOUND IN STRIPE ✓)
-- - Status: trialing (trial expires Sept 17, 2026)
-- - Price: $19.99/month
-- - Metadata Match: userId in Stripe matches DB ✓

BEGIN;

-- Fix 1: Add missing Stripe subscription ID to subscriptions table
UPDATE subscriptions
SET stripe_subscription_id = 'sub_1UDxyhGnNbF6OYVRCTb5up2M',
    status = 'active'
WHERE user_id = 'c500c661-bf1d-4862-8bca-72df389dd378';

-- Fix 2: Log this manual correction in audit trail
INSERT INTO subscription_events (
  user_id,
  event_type,
  stripe_event_id,
  stripe_customer_id,
  stripe_subscription_id,
  previous_plan,
  new_plan,
  details
) VALUES (
  'c500c661-bf1d-4862-8bca-72df389dd378',
  'manual_sync_correction',
  'manual_20260913_daphnes_camcash_webhook_recovery',
  'cus_VEQprrXTfPwvGp',
  'sub_1UDxyhGnNbF6OYVRCTb5up2M',
  'pro',
  'pro',
  jsonb_build_object(
    'reason', 'RECOVERY: Webhook sync failure - subscription ID never captured',
    'trial_ends', '2026-09-17 02:44:43+00',
    'stripe_subscription', 'sub_1UDxyhGnNbF6OYVRCTb5up2M',
    'stripe_customer', 'cus_VEQprrXTfPwvGp',
    'monthly_price', 1999,
    'metadata_verified', true,
    'root_cause', 'Subscription created in Stripe but webhook failed to log/sync to database'
  )
);

COMMIT;

-- Verification: Confirm fixes were applied
-- SELECT * FROM profiles WHERE id = 'c500c661-bf1d-4862-8bca-72df389dd378';
-- SELECT * FROM subscriptions WHERE user_id = 'c500c661-bf1d-4862-8bca-72df389dd378';
-- SELECT * FROM subscription_events WHERE user_id = 'c500c661-bf1d-4862-8bca-72df389dd378' ORDER BY created_at DESC;
