-- =====================================================
-- ADD PRO BUNDLE PLAN TYPE
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- =====================================================

-- Update the plan_type check constraint to include pro_bundle
ALTER TABLE user_subscriptions 
DROP CONSTRAINT IF EXISTS user_subscriptions_plan_type_check;

ALTER TABLE user_subscriptions 
ADD CONSTRAINT user_subscriptions_plan_type_check 
CHECK (plan_type IN ('free', 'host_pro', 'ad_free_plus', 'ad_free_premium', 'pro_bundle'));

-- Done! The pro_bundle plan type is now supported.
