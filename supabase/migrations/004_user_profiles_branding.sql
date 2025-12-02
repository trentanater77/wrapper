-- =====================================================
-- USER PROFILES & BRANDING
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- =====================================================

-- 1. USER PROFILES TABLE
-- Stores custom branding, badges, and profile settings
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Display info
    display_name TEXT,
    bio TEXT,
    
    -- Custom branding (for Host Pro / Pro Bundle)
    custom_logo_url TEXT,           -- URL to custom logo image
    logo_updated_at TIMESTAMPTZ,
    
    -- Badge settings
    badge_type TEXT DEFAULT 'none' CHECK (badge_type IN (
        'none',           -- No badge
        'pro',            -- Host Pro badge (gold star)
        'premium',        -- Ad-Free Premium badge (diamond)
        'bundle',         -- Pro Bundle badge (crown)
        'verified',       -- Verified creator
        'og',             -- Early adopter
        'custom'          -- Custom badge (future)
    )),
    badge_visible BOOLEAN DEFAULT true,  -- User can toggle badge visibility
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One profile per user
    UNIQUE(user_id)
);

-- 2. INDEXES
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- 3. ROW LEVEL SECURITY
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can view any profile (badges are public)
CREATE POLICY "Anyone can view profiles" ON user_profiles
    FOR SELECT USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can do everything
CREATE POLICY "Service role full access profiles" ON user_profiles
    FOR ALL USING (auth.role() = 'service_role');

-- 4. AUTO-UPDATE TIMESTAMP TRIGGER
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trigger_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profiles_updated_at();

-- 5. HELPER FUNCTION: Get user badge info
CREATE OR REPLACE FUNCTION get_user_badge(p_user_id UUID)
RETURNS TABLE (
    badge_type TEXT,
    badge_visible BOOLEAN,
    custom_logo_url TEXT,
    display_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(up.badge_type, 'none') as badge_type,
        COALESCE(up.badge_visible, true) as badge_visible,
        up.custom_logo_url,
        up.display_name
    FROM auth.users u
    LEFT JOIN user_profiles up ON u.id = up.user_id
    WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. HELPER FUNCTION: Auto-assign badge based on subscription
CREATE OR REPLACE FUNCTION sync_user_badge_with_subscription()
RETURNS TRIGGER AS $$
DECLARE
    new_badge TEXT;
BEGIN
    -- Determine badge based on plan
    CASE NEW.plan_type
        WHEN 'pro_bundle' THEN new_badge := 'bundle';
        WHEN 'host_pro' THEN new_badge := 'pro';
        WHEN 'ad_free_premium' THEN new_badge := 'premium';
        WHEN 'ad_free_plus' THEN new_badge := 'premium';
        ELSE new_badge := 'none';
    END CASE;
    
    -- Upsert user profile with badge
    INSERT INTO user_profiles (user_id, badge_type)
    VALUES (NEW.user_id, new_badge)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        badge_type = new_badge,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to sync badge when subscription changes
DROP TRIGGER IF EXISTS trigger_sync_badge_on_subscription ON user_subscriptions;
CREATE TRIGGER trigger_sync_badge_on_subscription
    AFTER INSERT OR UPDATE OF plan_type ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_badge_with_subscription();

-- Done!
-- After running this, you should see:
-- - user_profiles table with badge and branding columns
-- - Automatic badge sync when subscription changes
