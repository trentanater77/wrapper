-- Stripe Connect Integration
-- Stores connected Stripe account info for creators

-- Add Stripe Connect columns to gem_balances
ALTER TABLE gem_balances 
ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_account_status TEXT DEFAULT 'not_connected' 
  CHECK (stripe_account_status IN ('not_connected', 'pending', 'active', 'restricted', 'disabled')),
ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stripe_connected_at TIMESTAMPTZ;

-- Index for faster lookups by Stripe account ID
CREATE INDEX IF NOT EXISTS idx_gem_balances_stripe_account ON gem_balances(stripe_account_id);

-- Add Stripe transfer tracking to payout_requests
ALTER TABLE payout_requests
ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payout_id TEXT,
ADD COLUMN IF NOT EXISTS auto_payout BOOLEAN DEFAULT FALSE;

-- Stripe Connect Events table (for webhook idempotency)
CREATE TABLE IF NOT EXISTS stripe_connect_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  account_id TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup of old events
CREATE INDEX IF NOT EXISTS idx_connect_events_processed ON stripe_connect_events(processed_at);

SELECT 'Migration 018 (Stripe Connect) complete!' as status;
