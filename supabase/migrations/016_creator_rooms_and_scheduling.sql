-- =====================================================
-- CHATSPHERES CREATOR ROOMS & SCHEDULING SYSTEM
-- Migration for Creator Room mode, Queue system, and Event scheduling
-- =====================================================

-- 1. ADD CREATOR ROOM TYPE TO ACTIVE_ROOMS
-- Alter the room_type check constraint to include 'creator'
ALTER TABLE active_rooms DROP CONSTRAINT IF EXISTS active_rooms_room_type_check;
ALTER TABLE active_rooms ADD CONSTRAINT active_rooms_room_type_check 
    CHECK (room_type IN ('red', 'green', 'creator'));

-- Add creator room specific columns to active_rooms
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS is_creator_room BOOLEAN DEFAULT false;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS challenger_time_limit INTEGER; -- seconds per challenger, NULL = unlimited
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS max_queue_size INTEGER; -- NULL = unlimited
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_id UUID REFERENCES auth.users(id);
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_name TEXT;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_started_at TIMESTAMPTZ;

-- 2. ROOM QUEUE TABLE
-- Tracks users waiting in queue for creator rooms
CREATE TABLE IF NOT EXISTS room_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    
    -- User info (NULL user_id = guest)
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_name TEXT, -- For guests without accounts
    guest_session_id TEXT, -- To identify guest across requests
    
    -- Position in queue (1 = next up)
    position INTEGER NOT NULL,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'left')),
    
    -- Timestamps
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    called_at TIMESTAMPTZ, -- When they became the active challenger
    ended_at TIMESTAMPTZ,
    
    -- Unique constraint: one entry per user/guest per room
    UNIQUE(room_id, user_id),
    UNIQUE(room_id, guest_session_id)
);

-- 3. SCHEDULED EVENTS TABLE
-- For creators to schedule future rooms
CREATE TABLE IF NOT EXISTS scheduled_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Host info
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    host_name TEXT,
    host_avatar TEXT,
    
    -- Event details
    title TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT, -- Optional thumbnail/cover
    
    -- Room settings (pre-configured)
    room_type TEXT NOT NULL DEFAULT 'creator' CHECK (room_type IN ('red', 'green', 'creator')),
    challenger_time_limit INTEGER, -- For creator rooms
    max_queue_size INTEGER,
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ NOT NULL, -- When the event will go live
    timezone TEXT DEFAULT 'UTC',
    
    -- Status
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    
    -- When it actually went live
    room_id TEXT, -- Links to active_rooms when live
    went_live_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. EVENT REMINDERS TABLE
-- Track users who want to be reminded about events
CREATE TABLE IF NOT EXISTS event_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
    
    -- User info (can be logged in or guest with email)
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT, -- For guests or additional email
    
    -- Browser push subscription (for push notifications)
    push_subscription JSONB,
    
    -- Notification preferences
    notify_browser BOOLEAN DEFAULT true,
    notify_email BOOLEAN DEFAULT false,
    
    -- Status
    reminder_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One reminder per user per event
    UNIQUE(event_id, user_id),
    UNIQUE(event_id, email)
);

-- 5. CREATOR PARTNERS TABLE
-- Simple flag system for creator partner program
CREATE TABLE IF NOT EXISTS creator_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    
    -- Partner status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
    
    -- Revenue split (100 = 100% to creator, 0 platform cut)
    tip_share_percent INTEGER NOT NULL DEFAULT 100 CHECK (tip_share_percent >= 0 AND tip_share_percent <= 100),
    
    -- Partner tier (for future expansion)
    tier TEXT DEFAULT 'founding' CHECK (tier IN ('founding', 'standard', 'premium')),
    
    -- Application info
    application_note TEXT,
    approved_by TEXT, -- Admin who approved
    approved_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. PARTNER APPLICATIONS TABLE
-- For users applying to become creator partners
CREATE TABLE IF NOT EXISTS partner_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Application details
    social_links TEXT, -- Their social media presence
    audience_size TEXT, -- Estimated audience
    content_type TEXT, -- What kind of content they create
    why_partner TEXT, -- Why they want to be a partner
    
    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT,
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One pending application per user
    UNIQUE(user_id)
);

-- 7. INDEXES
CREATE INDEX IF NOT EXISTS idx_room_queue_room ON room_queue(room_id);
CREATE INDEX IF NOT EXISTS idx_room_queue_status ON room_queue(room_id, status);
CREATE INDEX IF NOT EXISTS idx_room_queue_position ON room_queue(room_id, position) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_scheduled_events_host ON scheduled_events(host_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_status ON scheduled_events(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_time ON scheduled_events(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_event_reminders_event ON event_reminders(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reminders_user ON event_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_partners_user ON creator_partners(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_partners_status ON creator_partners(status);

-- 8. ROW LEVEL SECURITY
ALTER TABLE room_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

-- Room Queue policies
CREATE POLICY "Anyone can view room queue" ON room_queue
    FOR SELECT USING (true);

CREATE POLICY "Users can join queue" ON room_queue
    FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can leave queue" ON room_queue
    FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Service role full access room_queue" ON room_queue
    FOR ALL USING (auth.role() = 'service_role');

-- Scheduled Events policies
CREATE POLICY "Anyone can view scheduled events" ON scheduled_events
    FOR SELECT USING (true);

CREATE POLICY "Hosts can manage own events" ON scheduled_events
    FOR ALL USING (host_id = auth.uid());

CREATE POLICY "Service role full access scheduled_events" ON scheduled_events
    FOR ALL USING (auth.role() = 'service_role');

-- Event Reminders policies
CREATE POLICY "Users can view own reminders" ON event_reminders
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create reminders" ON event_reminders
    FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own reminders" ON event_reminders
    FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "Service role full access event_reminders" ON event_reminders
    FOR ALL USING (auth.role() = 'service_role');

-- Creator Partners policies (read-only for users, service role manages)
CREATE POLICY "Anyone can view active partners" ON creator_partners
    FOR SELECT USING (status = 'active');

CREATE POLICY "Service role full access creator_partners" ON creator_partners
    FOR ALL USING (auth.role() = 'service_role');

-- Partner Applications policies
CREATE POLICY "Users can view own applications" ON partner_applications
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create applications" ON partner_applications
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role full access partner_applications" ON partner_applications
    FOR ALL USING (auth.role() = 'service_role');

-- 9. HELPER FUNCTION: Get queue position
CREATE OR REPLACE FUNCTION get_queue_position(p_room_id TEXT, p_user_id UUID DEFAULT NULL, p_guest_session_id TEXT DEFAULT NULL)
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

-- 10. HELPER FUNCTION: Check if user is a creator partner
CREATE OR REPLACE FUNCTION is_creator_partner(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM creator_partners 
        WHERE user_id = p_user_id AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. HELPER FUNCTION: Get partner tip share percentage
CREATE OR REPLACE FUNCTION get_partner_tip_share(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    share_percent INTEGER;
BEGIN
    SELECT tip_share_percent INTO share_percent
    FROM creator_partners
    WHERE user_id = p_user_id AND status = 'active';
    
    -- Default to standard platform rate if not a partner (e.g., 85%)
    RETURN COALESCE(share_percent, 85);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done!
-- Tables created:
-- - room_queue: Queue system for creator rooms
-- - scheduled_events: Future event scheduling
-- - event_reminders: "Remind Me" subscriptions
-- - creator_partners: Creator partner program
-- - partner_applications: Partner application form data
