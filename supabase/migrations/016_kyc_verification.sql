-- KYC Verification Table
-- Stores Stripe Identity verification status for users

CREATE TABLE IF NOT EXISTS kyc_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_verification_id TEXT,
  status TEXT DEFAULT 'unverified' CHECK (status IN ('unverified', 'pending', 'verified', 'failed')),
  verified_at TIMESTAMPTZ,
  first_name TEXT,
  last_name TEXT,
  date_of_birth DATE,
  document_type TEXT, -- 'passport', 'id_card', 'driving_license'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_kyc_user_id ON kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_stripe_id ON kyc_verifications(stripe_verification_id);

-- Enable RLS
ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own verification status
CREATE POLICY "Users can view own KYC status"
  ON kyc_verifications FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert/update (from Netlify functions)
CREATE POLICY "Service role can manage KYC"
  ON kyc_verifications FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Add kyc_verified column to gem_balances for quick checks
ALTER TABLE gem_balances 
ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT FALSE;
