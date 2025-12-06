-- Migration: Add referral gem vesting system
-- This implements fraud-protected cashable referral gems

-- Add pending_referral_gems column to gem_balances
ALTER TABLE gem_balances 
ADD COLUMN IF NOT EXISTS pending_referral_gems INTEGER DEFAULT 0;

-- Add vesting columns to referrals table
ALTER TABLE referrals 
ADD COLUMN IF NOT EXISTS vested BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS vested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS vested_reason TEXT;

-- Add conversation_count to track user activity for time-based vesting
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS conversation_count INTEGER DEFAULT 0;

-- Create an index for faster vesting checks
CREATE INDEX IF NOT EXISTS idx_referrals_vesting 
ON referrals(referred_user_id, vested, status);

-- Add comment explaining the vesting system
COMMENT ON COLUMN gem_balances.pending_referral_gems IS 
'Referral gems waiting to vest. Become cashable when referred user makes purchase or is active 30+ days with 5+ conversations.';

COMMENT ON COLUMN referrals.vested IS 
'Whether the referral gems have vested (become cashable). Vesting occurs when referred user makes purchase or meets activity requirements.';

COMMENT ON COLUMN referrals.vested_reason IS 
'Reason for vesting: "purchase", "subscription", or "activity_30d_5chats"';
