-- =====================================================
-- CHATSPHERES ROOM QUEUE & SCHEDULING SYSTEM
-- Migration 016: Creator Room Queue + Scheduled Rooms
-- =====================================================

-- 1. ROOM QUEUE TABLE
-- Tracks spectators waiting to join as participant 2
CREATE TABLE IF NOT EXISTS room_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    
    -- User waiting in queue
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_name TEXT,
    user_avatar TEXT,
    
    -- Queue position (lower = earlier in queue)
    position INTEGER NOT NULL,
    
    -- Status: 'waiting', 'called' (their turn), 'joined', 'skipped', 'left'
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'joined', 'skipped', 'left')),
    
    -- Timestamps
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    called_at TIMESTAMPTZ,
    
    -- Unique constraint: one queue entry per user per room
    UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_queue_room ON room_queue(room_id);
CREATE INDEX IF NOT EXISTS idx_room_queue_user ON room_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_room_queue_status ON room_queue(room_id, status, position);

-- 2. SCHEDULED ROOMS TABLE
-- Rooms scheduled for future times
CREATE TABLE IF NOT EXISTS scheduled_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Host info
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    host_name TEXT,
    host_avatar TEXT,
    
    -- Room details
    topic TEXT NOT NULL,
    description TEXT,
    room_type TEXT NOT NULL DEFAULT 'red' CHECK (room_type IN ('red', 'green')),
    
    -- Scheduling
    scheduled_for TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    
    -- Visibility
    is_public BOOLEAN DEFAULT true,
    
    -- Interest tracking
    interested_count INTEGER DEFAULT 0,
    
    -- Status: 'scheduled', 'live', 'ended', 'cancelled'
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    
    -- When it goes live, this links to the actual room
    live_room_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_rooms_host ON scheduled_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_rooms_status ON scheduled_rooms(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_rooms_scheduled ON scheduled_rooms(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_rooms_public ON scheduled_rooms(is_public, status, scheduled_for);

-- 3. SCHEDULED ROOM INTEREST TABLE
-- Users who clicked "Remind Me"
CREATE TABLE IF NOT EXISTS scheduled_room_interest (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_room_id UUID NOT NULL REFERENCES scheduled_rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Notification preferences
    notify_email BOOLEAN DEFAULT true,
    notify_push BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(scheduled_room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_interest_room ON scheduled_room_interest(scheduled_room_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interest_user ON scheduled_room_interest(user_id);

-- 4. ADD QUEUE MODE TO ACTIVE ROOMS
-- Rooms can now be in 'queue_mode' where host cycles through challengers
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS queue_mode BOOLEAN DEFAULT false;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_id UUID;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS queue_count INTEGER DEFAULT 0;

-- 5. ROW LEVEL SECURITY
ALTER TABLE room_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_room_interest ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access room_queue" ON room_queue
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access scheduled_rooms" ON scheduled_rooms
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access scheduled_room_interest" ON scheduled_room_interest
    FOR ALL USING (auth.role() = 'service_role');

-- Users can view queue for rooms they're in
CREATE POLICY "Users can view room queue" ON room_queue
    FOR SELECT USING (true);

-- Users can manage their own queue entry
CREATE POLICY "Users can manage own queue entry" ON room_queue
    FOR ALL USING (user_id = auth.uid());

-- Anyone can view public scheduled rooms
CREATE POLICY "Anyone can view public scheduled rooms" ON scheduled_rooms
    FOR SELECT USING (is_public = true OR host_id = auth.uid());

-- Hosts can manage their scheduled rooms
CREATE POLICY "Hosts can manage scheduled rooms" ON scheduled_rooms
    FOR ALL USING (host_id = auth.uid());

-- Users can manage their own interest
CREATE POLICY "Users can manage own interest" ON scheduled_room_interest
    FOR ALL USING (user_id = auth.uid());

-- 6. HELPER FUNCTION: Get next in queue
CREATE OR REPLACE FUNCTION get_next_in_queue(p_room_id TEXT)
RETURNS TABLE (
    user_id UUID,
    user_name TEXT,
    user_avatar TEXT,
    position INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rq.user_id,
        rq.user_name,
        rq.user_avatar,
        rq.position
    FROM room_queue rq
    WHERE rq.room_id = p_room_id 
    AND rq.status = 'waiting'
    ORDER BY rq.position ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. HELPER FUNCTION: Update interest count
CREATE OR REPLACE FUNCTION update_scheduled_room_interest_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE scheduled_rooms 
        SET interested_count = interested_count + 1,
            updated_at = NOW()
        WHERE id = NEW.scheduled_room_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE scheduled_rooms 
        SET interested_count = GREATEST(0, interested_count - 1),
            updated_at = NOW()
        WHERE id = OLD.scheduled_room_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_interest_count ON scheduled_room_interest;
CREATE TRIGGER trigger_update_interest_count
AFTER INSERT OR DELETE ON scheduled_room_interest
FOR EACH ROW EXECUTE FUNCTION update_scheduled_room_interest_count();

-- Done!
-- Tables created:
-- - room_queue: Queue for spectators to become participant 2
-- - scheduled_rooms: Future scheduled events
-- - scheduled_room_interest: "Remind Me" tracking
