-- =====================================================
-- CHATSPHERES MODERATION & REFERRAL SYSTEM
-- Migration 005: Moderation and Referral Tables
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- =====================================================

-- =====================================================
-- 1. USER RATINGS TABLE
-- Stores thumbs up/down ratings between users after calls
-- =====================================================
CREATE TABLE IF NOT EXISTS user_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Who is rating whom
    rater_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rated_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Which room/call this rating is for
    room_id TEXT NOT NULL,
    
    -- The rating itself
    rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
    
    -- Optional feedback text
    feedback TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One rating per rater/rated/room combination
    UNIQUE(rater_id, rated_id, room_id)
);

-- =====================================================
-- 2. PENDING RATINGS TABLE
-- Tracks ratings that users skipped (to show again later)
-- =====================================================
CREATE TABLE IF NOT EXISTS pending_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The user who needs to rate
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- The room where the call happened
    room_id TEXT NOT NULL,
    
    -- Who they need to rate
    other_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    other_user_name TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One pending rating per user/room
    UNIQUE(user_id, room_id)
);

-- =====================================================
-- 3. USER REPORTS TABLE
-- Stores reports of inappropriate behavior
-- =====================================================
CREATE TABLE IF NOT EXISTS user_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Who is reporting whom
    reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reported_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Which room this happened in
    room_id TEXT,
    
    -- Report details (matches UI categories)
    category TEXT NOT NULL CHECK (category IN (
        'inappropriate',
        'harassment', 
        'underage',
        'spam',
        'other'
    )),
    description TEXT,
    
    -- Status of the report
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
    
    -- Admin notes (for moderation)
    admin_notes TEXT,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate reports for same incident
    UNIQUE(reporter_id, reported_id, room_id)
);

-- =====================================================
-- 4. USER SUSPENSIONS TABLE
-- Tracks suspended/banned users
-- =====================================================
CREATE TABLE IF NOT EXISTS user_suspensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The suspended user
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Suspension details
    reason TEXT NOT NULL,
    
    -- Who suspended them (null = automatic, 'system' = auto-moderation)
    suspended_by TEXT,
    
    -- Related report if any
    related_report_id UUID REFERENCES user_reports(id),
    
    -- Timing
    suspended_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- NULL = permanent
    
    -- Is this suspension currently active?
    is_active BOOLEAN DEFAULT TRUE,
    
    -- If lifted early
    lifted_at TIMESTAMPTZ,
    lifted_by UUID REFERENCES auth.users(id),
    lift_reason TEXT
);

-- =====================================================
-- 5. USER BLOCKS TABLE
-- Users can block other users (never matched again)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Who blocked whom
    blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One block per pair
    UNIQUE(blocker_id, blocked_id)
);

-- =====================================================
-- 6. REFERRALS TABLE
-- Tracks referral signups and rewards
-- =====================================================
CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The person who shared the link
    referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- The referral code used
    referral_code TEXT NOT NULL,
    
    -- The person who signed up (null until they do)
    referred_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'clicked' CHECK (status IN (
        'clicked',      -- Link was clicked
        'signed_up',    -- User created account
        'rewarded'      -- Both parties got gems
    )),
    
    -- Gem tracking
    gems_awarded_referrer INTEGER DEFAULT 0,
    gems_awarded_referred INTEGER DEFAULT 0,
    
    -- Bonus tracking
    first_purchase_rewarded BOOLEAN,
    subscription_rewarded BOOLEAN,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 7. MUTED CHAT USERS TABLE (for hosts to mute viewers)
-- =====================================================
CREATE TABLE IF NOT EXISTS muted_chat_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The room where mute applies
    room_id TEXT NOT NULL,
    
    -- The host who muted
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- The muted user
    muted_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Timestamps
    muted_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One mute per room/user pair
    UNIQUE(room_id, muted_user_id)
);

-- =====================================================
-- 8. INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_user_ratings_rater ON user_ratings(rater_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_rated ON user_ratings(rated_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_room ON user_ratings(room_id);

CREATE INDEX IF NOT EXISTS idx_pending_ratings_user ON pending_ratings(user_id);

CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status);

CREATE INDEX IF NOT EXISTS idx_user_suspensions_user ON user_suspensions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_suspensions_active ON user_suspensions(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

CREATE INDEX IF NOT EXISTS idx_muted_chat_room ON muted_chat_users(room_id);

-- =====================================================
-- 9. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE user_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE muted_chat_users ENABLE ROW LEVEL SECURITY;

-- Users can view their own ratings (given or received)
CREATE POLICY "Users can view own ratings" ON user_ratings
    FOR SELECT USING (auth.uid() = rater_id OR auth.uid() = rated_id);

-- Users can view their own pending ratings
CREATE POLICY "Users can view own pending ratings" ON pending_ratings
    FOR SELECT USING (auth.uid() = user_id);

-- Users can view reports they made
CREATE POLICY "Users can view own reports" ON user_reports
    FOR SELECT USING (auth.uid() = reporter_id);

-- Users can view their own suspension status
CREATE POLICY "Users can view own suspensions" ON user_suspensions
    FOR SELECT USING (auth.uid() = user_id);

-- Users can view their own blocks
CREATE POLICY "Users can view own blocks" ON user_blocks
    FOR SELECT USING (auth.uid() = blocker_id);

-- Users can view referrals they made
CREATE POLICY "Users can view own referrals" ON referrals
    FOR SELECT USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

-- Hosts can view muted users in their rooms
CREATE POLICY "Hosts can view muted users" ON muted_chat_users
    FOR SELECT USING (auth.uid() = host_id);

-- Service role (backend) can do everything
CREATE POLICY "Service role full access ratings" ON user_ratings
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access pending_ratings" ON pending_ratings
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access reports" ON user_reports
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access suspensions" ON user_suspensions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access blocks" ON user_blocks
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access referrals" ON referrals
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access muted_chat" ON muted_chat_users
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- 10. HELPER FUNCTIONS
-- =====================================================

-- Function to check if user is suspended
CREATE OR REPLACE FUNCTION is_user_suspended(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_suspensions
        WHERE user_id = p_user_id
        AND is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's bad rating count (for auto-moderation)
CREATE OR REPLACE FUNCTION get_user_bad_rating_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER FROM user_ratings
        WHERE rated_id = p_user_id
        AND rating = 'bad'
        AND created_at > NOW() - INTERVAL '30 days'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's report count (for auto-moderation)
CREATE OR REPLACE FUNCTION get_user_report_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER FROM user_reports
        WHERE reported_id = p_user_id
        AND status != 'dismissed'
        AND created_at > NOW() - INTERVAL '30 days'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if one user has blocked another
CREATE OR REPLACE FUNCTION is_blocked(p_user1 UUID, p_user2 UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_blocks
        WHERE (blocker_id = p_user1 AND blocked_id = p_user2)
           OR (blocker_id = p_user2 AND blocked_id = p_user1)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 11. PROFILES TABLE (if not exists)
-- Used for referral code lookups and user info
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles" ON profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access profiles" ON profiles
    FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- =====================================================
-- DONE! 
-- You should now have all tables needed for:
-- ✅ User ratings (thumbs up/down)
-- ✅ Pending ratings (skipped ratings)
-- ✅ User reports (flag inappropriate behavior)
-- ✅ User suspensions (ban users)
-- ✅ User blocks (personal blocks)
-- ✅ Referrals (affiliate tracking)
-- ✅ Muted chat users (host feature)
-- ✅ User profiles (for referral lookups)
-- =====================================================
