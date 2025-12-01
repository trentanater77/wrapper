-- =====================================================
-- CHATSPHERES SUBSCRIPTION SYSTEM
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- =====================================================

-- 1. USER SUBSCRIPTIONS TABLE
-- Tracks what plan each user is on
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Stripe IDs
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    
    -- Plan info
    plan_type TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'host_pro', 'ad_free_plus', 'ad_free_premium')),
    billing_period TEXT CHECK (billing_period IN ('monthly', 'yearly')),
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
    
    -- Timestamps
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure one subscription per user
    UNIQUE(user_id)
);

-- 2. GEM BALANCES TABLE
-- Tracks both spendable and cashable gems
CREATE TABLE IF NOT EXISTS gem_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Two wallet system
    spendable_gems INTEGER NOT NULL DEFAULT 0 CHECK (spendable_gems >= 0),
    cashable_gems INTEGER NOT NULL DEFAULT 0 CHECK (cashable_gems >= 0),
    
    -- Promo gems from referrals (subset of spendable, has restrictions)
    promo_gems INTEGER NOT NULL DEFAULT 0 CHECK (promo_gems >= 0),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One balance record per user
    UNIQUE(user_id)
);

-- 3. GEM TRANSACTIONS TABLE
-- Audit log of all gem movements
CREATE TABLE IF NOT EXISTS gem_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Who
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- What type of transaction
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'purchase',           -- Bought gems with money
        'subscription_bonus', -- Monthly gems from Ad-Free plans
        'tip_sent',          -- Tipped another user
        'tip_received',      -- Received a tip
        'entry_fee_paid',    -- Paid to enter Green Room
        'entry_fee_received',-- Host received entry fee
        'refund',            -- Gems refunded
        'promo',             -- Referral bonus
        'cashout'            -- Converted to real money
    )),
    
    -- Amount (positive = gained, negative = spent)
    amount INTEGER NOT NULL,
    
    -- Which wallet was affected
    wallet_type TEXT NOT NULL CHECK (wallet_type IN ('spendable', 'cashable')),
    
    -- Related user (for tips)
    related_user_id UUID REFERENCES auth.users(id),
    
    -- Related room (for tips/entry fees)
    room_id TEXT,
    
    -- Stripe payment ID (for purchases)
    stripe_payment_id TEXT,
    
    -- Description
    description TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. STRIPE EVENTS TABLE
-- Prevent duplicate webhook processing
CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY, -- Stripe event ID
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_gem_balances_user_id ON gem_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_gem_transactions_user_id ON gem_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_gem_transactions_created ON gem_transactions(created_at DESC);

-- 6. ROW LEVEL SECURITY (RLS)
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gem_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE gem_transactions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription
CREATE POLICY "Users can view own subscription" ON user_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- Users can read their own gem balance
CREATE POLICY "Users can view own gem balance" ON gem_balances
    FOR SELECT USING (auth.uid() = user_id);

-- Users can read their own transactions
CREATE POLICY "Users can view own transactions" ON gem_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Service role can do everything (for webhooks)
CREATE POLICY "Service role full access subscriptions" ON user_subscriptions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access balances" ON gem_balances
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access transactions" ON gem_transactions
    FOR ALL USING (auth.role() = 'service_role');

-- 7. HELPER FUNCTION: Get user's current plan
CREATE OR REPLACE FUNCTION get_user_plan(p_user_id UUID)
RETURNS TABLE (
    plan_type TEXT,
    status TEXT,
    expires_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(us.plan_type, 'free') as plan_type,
        COALESCE(us.status, 'active') as status,
        us.current_period_end as expires_at
    FROM auth.users u
    LEFT JOIN user_subscriptions us ON u.id = us.user_id
    WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. HELPER FUNCTION: Get user's gem balance
CREATE OR REPLACE FUNCTION get_user_gems(p_user_id UUID)
RETURNS TABLE (
    spendable INTEGER,
    cashable INTEGER,
    total INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(gb.spendable_gems, 0) as spendable,
        COALESCE(gb.cashable_gems, 0) as cashable,
        COALESCE(gb.spendable_gems, 0) + COALESCE(gb.cashable_gems, 0) as total
    FROM auth.users u
    LEFT JOIN gem_balances gb ON u.id = gb.user_id
    WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done!
-- After running this, you should see:
-- - user_subscriptions table
-- - gem_balances table
-- - gem_transactions table
-- - stripe_events table
