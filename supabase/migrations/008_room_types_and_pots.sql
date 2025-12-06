-- =====================================================
-- CHATSPHERES ROOM TYPES AND POT SYSTEM
-- Migration for Red Room (debates) and Green Room (help)
-- =====================================================

-- 1. ACTIVE ROOMS TABLE
-- Tracks all live rooms for display on /live.html
CREATE TABLE IF NOT EXISTS active_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL UNIQUE,
    
    -- Room type: 'red' (debate/fight) or 'green' (help/advice)
    room_type TEXT NOT NULL DEFAULT 'red' CHECK (room_type IN ('red', 'green')),
    
    -- Host info
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    host_name TEXT,
    host_avatar TEXT,
    
    -- Room details
    topic TEXT NOT NULL,
    description TEXT,
    
    -- Participant counts
    participant_count INTEGER DEFAULT 0,
    spectator_count INTEGER DEFAULT 0,
    
    -- For Red Rooms: current pot
    pot_amount INTEGER DEFAULT 0,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'voting', 'ended')),
    is_public BOOLEAN DEFAULT true,
    
    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ, -- For cliffhanger timer
    ended_at TIMESTAMPTZ,
    
    -- Invite code for private rooms
    invite_code TEXT UNIQUE
);

-- 2. RED ROOM POT TRANSACTIONS
-- Temporary holding for gems during debates
CREATE TABLE IF NOT EXISTS pot_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    
    -- Who tipped
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_name TEXT,
    
    -- Who they tipped (participant they want to win)
    recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Amount tipped
    amount INTEGER NOT NULL CHECK (amount > 0),
    
    -- Status: 'held' during debate, 'released' to winner, 'refunded' (void rule)
    status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'refunded')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ
);

-- 3. RED ROOM VOTES
-- Audience votes for winner at end of debate
CREATE TABLE IF NOT EXISTS room_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    
    -- Who voted
    voter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Who they voted for (or 'draw')
    voted_for UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    is_draw_vote BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One vote per user per room
    UNIQUE(room_id, voter_id)
);

-- 4. INDEXES
CREATE INDEX IF NOT EXISTS idx_active_rooms_status ON active_rooms(status);
CREATE INDEX IF NOT EXISTS idx_active_rooms_type ON active_rooms(room_type);
CREATE INDEX IF NOT EXISTS idx_active_rooms_host ON active_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_active_rooms_public ON active_rooms(is_public, status);
CREATE INDEX IF NOT EXISTS idx_pot_transactions_room ON pot_transactions(room_id);
CREATE INDEX IF NOT EXISTS idx_pot_transactions_status ON pot_transactions(status);
CREATE INDEX IF NOT EXISTS idx_room_votes_room ON room_votes(room_id);

-- 5. ROW LEVEL SECURITY
ALTER TABLE active_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pot_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_votes ENABLE ROW LEVEL SECURITY;

-- Anyone can view public active rooms
CREATE POLICY "Anyone can view public rooms" ON active_rooms
    FOR SELECT USING (is_public = true OR host_id = auth.uid());

-- Hosts can manage their own rooms
CREATE POLICY "Hosts can manage own rooms" ON active_rooms
    FOR ALL USING (host_id = auth.uid());

-- Service role can do everything
CREATE POLICY "Service role full access active_rooms" ON active_rooms
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access pot_transactions" ON pot_transactions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access room_votes" ON room_votes
    FOR ALL USING (auth.role() = 'service_role');

-- Users can view pot transactions for rooms they're in
CREATE POLICY "Users can view room pot transactions" ON pot_transactions
    FOR SELECT USING (sender_id = auth.uid() OR recipient_id = auth.uid());

-- Users can create pot transactions
CREATE POLICY "Users can create pot transactions" ON pot_transactions
    FOR INSERT WITH CHECK (sender_id = auth.uid());

-- Users can vote
CREATE POLICY "Users can vote" ON room_votes
    FOR INSERT WITH CHECK (voter_id = auth.uid());

-- Users can view votes
CREATE POLICY "Users can view votes" ON room_votes
    FOR SELECT USING (true);

-- 6. HELPER FUNCTION: Get total pot for a room
CREATE OR REPLACE FUNCTION get_room_pot(p_room_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN COALESCE(
        (SELECT SUM(amount) FROM pot_transactions WHERE room_id = p_room_id AND status = 'held'),
        0
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. HELPER FUNCTION: Get vote counts for a room
CREATE OR REPLACE FUNCTION get_room_votes(p_room_id TEXT)
RETURNS TABLE (
    participant_id UUID,
    vote_count BIGINT,
    draw_votes BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rv.voted_for as participant_id,
        COUNT(*) FILTER (WHERE rv.is_draw_vote = false) as vote_count,
        COUNT(*) FILTER (WHERE rv.is_draw_vote = true) as draw_votes
    FROM room_votes rv
    WHERE rv.room_id = p_room_id
    GROUP BY rv.voted_for;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done!
-- Tables created:
-- - active_rooms: Tracks live rooms for /live.html
-- - pot_transactions: Gem holding during Red Room debates
-- - room_votes: Audience voting for winner
