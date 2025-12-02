-- =============================================
-- Payout Requests Table
-- For hosts to request cashout of their gems
-- =============================================

-- Create payout_requests table
CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  gems_amount INTEGER NOT NULL CHECK (gems_amount >= 500), -- Minimum 500 gems ($4.95)
  usd_amount DECIMAL(10, 2) NOT NULL,
  payout_method TEXT NOT NULL DEFAULT 'paypal', -- 'paypal', 'bank', 'venmo'
  payout_email TEXT, -- PayPal email or Venmo username
  bank_details JSONB, -- For bank transfers (account number, routing, etc.)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected')),
  admin_notes TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_payout_requests_user_id ON payout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
CREATE INDEX IF NOT EXISTS idx_payout_requests_requested_at ON payout_requests(requested_at DESC);

-- RLS policies
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own payout requests
CREATE POLICY "Users can view own payout requests"
  ON payout_requests FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert payout requests for themselves
CREATE POLICY "Users can create own payout requests"
  ON payout_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for admin functions)
CREATE POLICY "Service role has full access to payout_requests"
  ON payout_requests FOR ALL
  USING (auth.role() = 'service_role');

-- Add payout_email column to gem_balances for convenience
ALTER TABLE gem_balances 
ADD COLUMN IF NOT EXISTS payout_email TEXT,
ADD COLUMN IF NOT EXISTS payout_method TEXT DEFAULT 'paypal';

-- Create function to get user's cashable balance
CREATE OR REPLACE FUNCTION get_user_cashable_gems(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  balance INTEGER;
BEGIN
  SELECT COALESCE(cashable_gems, 0) INTO balance
  FROM gem_balances
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Conversion rate: 100 gems = $0.99 (same as purchase rate)
-- So 500 gems minimum = $4.95 minimum payout
CREATE OR REPLACE FUNCTION gems_to_usd(gems INTEGER)
RETURNS DECIMAL AS $$
BEGIN
  RETURN ROUND((gems::DECIMAL / 100) * 0.99, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON TABLE payout_requests IS 'Tracks host payout requests for converting cashable gems to real money';
COMMENT ON FUNCTION gems_to_usd IS 'Converts gems to USD at rate of 100 gems = $0.99';
