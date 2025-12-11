-- =====================================================
-- CREATOR ROOMS, SCHEDULING & PARTNER PROGRAM
-- Run this entire script in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- 1. ADD CREATOR ROOM COLUMNS TO ACTIVE_ROOMS
-- =====================================================

-- Add room_type constraint if table exists
DO $$ 
BEGIN
    -- Drop old constraint if exists
    ALTER TABLE active_rooms DROP CONSTRAINT IF EXISTS active_rooms_room_type_check;
    
    -- Add new constraint allowing 'creator' type
    ALTER TABLE active_rooms ADD CONSTRAINT active_rooms_room_type_check 
        CHECK (room_type IN ('red', 'green', 'creator'));
EXCEPTION WHEN undefined_table THEN
    NULL;
END $$;

-- Add new columns for creator rooms
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS is_creator_room BOOLEAN DEFAULT false;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS challenger_time_limit INTEGER;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS max_queue_size INTEGER;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_id UUID;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_name TEXT;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_started_at TIMESTAMPTZ;

-- =====================================================
-- 2. ROOM QUEUE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS room_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    user_id UUID,
    guest_name TEXT,
    guest_session_id TEXT,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'left')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    called_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);

-- Add unique constraints (ignore if already exist)
DO $$ 
BEGIN
    ALTER TABLE room_queue ADD CONSTRAINT room_queue_user_unique UNIQUE(room_id, user_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ 
BEGIN
    ALTER TABLE room_queue ADD CONSTRAINT room_queue_guest_unique UNIQUE(room_id, guest_session_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_room_queue_room_id ON room_queue(room_id);
CREATE INDEX IF NOT EXISTS idx_room_queue_status ON room_queue(status);
CREATE INDEX IF NOT EXISTS idx_room_queue_position ON room_queue(room_id, position);

-- =====================================================
-- 3. SCHEDULED EVENTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS scheduled_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL,
    host_name TEXT,
    host_avatar TEXT,
    title TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    room_type TEXT NOT NULL DEFAULT 'creator' CHECK (room_type IN ('red', 'green', 'creator')),
    challenger_time_limit INTEGER,
    max_queue_size INTEGER,
    scheduled_at TIMESTAMPTZ NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    room_id TEXT,
    went_live_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_events_host ON scheduled_events(host_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_status ON scheduled_events(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_scheduled_at ON scheduled_events(scheduled_at);

-- =====================================================
-- 4. EVENT REMINDERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS event_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
    user_id UUID,
    email TEXT,
    push_subscription JSONB,
    notify_browser BOOLEAN DEFAULT true,
    notify_email BOOLEAN DEFAULT false,
    reminder_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraints
DO $$ 
BEGIN
    ALTER TABLE event_reminders ADD CONSTRAINT event_reminders_user_unique UNIQUE(event_id, user_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ 
BEGIN
    ALTER TABLE event_reminders ADD CONSTRAINT event_reminders_email_unique UNIQUE(event_id, email);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_reminders_event ON event_reminders(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reminders_user ON event_reminders(user_id);

-- =====================================================
-- 5. CREATOR PARTNERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS creator_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
    tip_share_percent INTEGER NOT NULL DEFAULT 100 CHECK (tip_share_percent >= 0 AND tip_share_percent <= 100),
    tier TEXT DEFAULT 'founding' CHECK (tier IN ('founding', 'standard', 'premium')),
    application_note TEXT,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_creator_partners_user ON creator_partners(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_partners_status ON creator_partners(status);

-- =====================================================
-- 6. PARTNER APPLICATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS partner_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    social_links TEXT,
    audience_size TEXT,
    content_type TEXT,
    why_partner TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT,
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partner_applications_user ON partner_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_partner_applications_status ON partner_applications(status);

-- =====================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE room_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

-- room_queue policies
DROP POLICY IF EXISTS "Anyone can read room queue" ON room_queue;
CREATE POLICY "Anyone can read room queue" ON room_queue FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can join queue" ON room_queue;
CREATE POLICY "Users can join queue" ON room_queue FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own queue entry" ON room_queue;
CREATE POLICY "Users can update own queue entry" ON room_queue FOR UPDATE 
USING (user_id = auth.uid() OR guest_session_id IS NOT NULL);

DROP POLICY IF EXISTS "Users can leave queue" ON room_queue;
CREATE POLICY "Users can leave queue" ON room_queue FOR DELETE 
USING (user_id = auth.uid() OR guest_session_id IS NOT NULL);

-- scheduled_events policies
DROP POLICY IF EXISTS "Anyone can read scheduled events" ON scheduled_events;
CREATE POLICY "Anyone can read scheduled events" ON scheduled_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create own events" ON scheduled_events;
CREATE POLICY "Users can create own events" ON scheduled_events FOR INSERT 
WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can update own events" ON scheduled_events;
CREATE POLICY "Hosts can update own events" ON scheduled_events FOR UPDATE 
USING (auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can delete own events" ON scheduled_events;
CREATE POLICY "Hosts can delete own events" ON scheduled_events FOR DELETE 
USING (auth.uid() = host_id);

-- event_reminders policies
DROP POLICY IF EXISTS "Anyone can read reminder counts" ON event_reminders;
CREATE POLICY "Anyone can read reminder counts" ON event_reminders FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create reminders" ON event_reminders;
CREATE POLICY "Users can create reminders" ON event_reminders FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own reminders" ON event_reminders;
CREATE POLICY "Users can update own reminders" ON event_reminders FOR UPDATE 
USING (user_id = auth.uid() OR email IS NOT NULL);

DROP POLICY IF EXISTS "Users can delete own reminders" ON event_reminders;
CREATE POLICY "Users can delete own reminders" ON event_reminders FOR DELETE 
USING (user_id = auth.uid() OR email IS NOT NULL);

-- creator_partners policies
DROP POLICY IF EXISTS "Anyone can check partner status" ON creator_partners;
CREATE POLICY "Anyone can check partner status" ON creator_partners FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage partners" ON creator_partners;
CREATE POLICY "Service role can manage partners" ON creator_partners FOR ALL 
USING (auth.role() = 'service_role');

-- partner_applications policies
DROP POLICY IF EXISTS "Users can read own applications" ON partner_applications;
CREATE POLICY "Users can read own applications" ON partner_applications FOR SELECT 
USING (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can create own applications" ON partner_applications;
CREATE POLICY "Users can create own applications" ON partner_applications FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage applications" ON partner_applications;
CREATE POLICY "Service role can manage applications" ON partner_applications FOR ALL 
USING (auth.role() = 'service_role');

-- =====================================================
-- 8. HELPER FUNCTIONS
-- =====================================================

-- Get queue position for a user
CREATE OR REPLACE FUNCTION get_queue_position(
    p_room_id TEXT, 
    p_user_id UUID DEFAULT NULL, 
    p_guest_session_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    position INTEGER,
    total_in_queue BIGINT,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rq.position,
        (SELECT COUNT(*) FROM room_queue WHERE room_id = p_room_id AND status = 'waiting') as total_in_queue,
        rq.status
    FROM room_queue rq
    WHERE rq.room_id = p_room_id
      AND (
          (p_user_id IS NOT NULL AND rq.user_id = p_user_id)
          OR (p_guest_session_id IS NOT NULL AND rq.guest_session_id = p_guest_session_id)
      );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is a creator partner
CREATE OR REPLACE FUNCTION is_creator_partner(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM creator_partners 
        WHERE user_id = p_user_id AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get partner tip share percentage (returns 85 for non-partners)
CREATE OR REPLACE FUNCTION get_partner_tip_share(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    share_percent INTEGER;
BEGIN
    SELECT tip_share_percent INTO share_percent
    FROM creator_partners
    WHERE user_id = p_user_id AND status = 'active';
    
    RETURN COALESCE(share_percent, 85);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DONE! 
-- =====================================================

SELECT 'Migration complete! Tables created:' as status;
SELECT '- room_queue' as table_name;
SELECT '- scheduled_events' as table_name;
SELECT '- event_reminders' as table_name;
SELECT '- creator_partners' as table_name;
SELECT '- partner_applications' as table_name;
