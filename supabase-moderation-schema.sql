-- ============================================
-- CHATSPHERES MODERATION SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. User Ratings (thumbs up/down after calls)
CREATE TABLE IF NOT EXISTS user_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id UUID NOT NULL,
  rated_id UUID NOT NULL,
  room_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  feedback TEXT, -- Optional written feedback
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent duplicate ratings for same call
  UNIQUE(rater_id, rated_id, room_id)
);

-- Index for looking up user's rating history
CREATE INDEX IF NOT EXISTS idx_user_ratings_rated ON user_ratings(rated_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_rater ON user_ratings(rater_id);

-- 2. Pending Ratings (shown on next page visit if user closed early)
CREATE TABLE IF NOT EXISTS pending_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  room_id TEXT NOT NULL,
  other_user_id UUID NOT NULL,
  other_user_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- One pending rating per user per room
  UNIQUE(user_id, room_id)
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_pending_ratings_user ON pending_ratings(user_id);

-- 3. User Reports (flagging bad behavior)
CREATE TABLE IF NOT EXISTS user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL,
  reported_id UUID NOT NULL,
  room_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('inappropriate', 'harassment', 'underage', 'spam', 'other')),
  description TEXT, -- Optional details
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for counting reports against a user
CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_created ON user_reports(created_at);

-- 4. User Blocks (never match these users again)
CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL,
  blocked_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Can only block someone once
  UNIQUE(blocker_id, blocked_id)
);

-- Indexes for checking blocks in both directions
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- 5. User Suspensions (temp or permanent bans)
CREATE TABLE IF NOT EXISTS user_suspensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  reason TEXT NOT NULL,
  suspended_by TEXT DEFAULT 'system', -- 'system' for auto, admin ID for manual
  suspended_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- NULL = permanent
  is_active BOOLEAN DEFAULT true,
  
  -- Track suspension history
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for checking if user is suspended
CREATE INDEX IF NOT EXISTS idx_user_suspensions_user ON user_suspensions(user_id, is_active);

-- 6. Chat Mutes (host muting users in spectator chat)
CREATE TABLE IF NOT EXISTS chat_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  muted_user_id UUID NOT NULL,
  muted_by_host_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- One mute per user per room
  UNIQUE(room_id, muted_user_id)
);

-- Index for checking mutes in a room
CREATE INDEX IF NOT EXISTS idx_chat_mutes_room ON chat_mutes(room_id);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to count recent reports against a user (last 7 days)
CREATE OR REPLACE FUNCTION count_recent_reports(target_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(DISTINCT reporter_id)::INTEGER
  FROM user_reports
  WHERE reported_id = target_user_id
    AND created_at > NOW() - INTERVAL '7 days';
$$ LANGUAGE SQL;

-- Function to check if user is currently suspended
CREATE OR REPLACE FUNCTION is_user_suspended(target_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM user_suspensions
    WHERE user_id = target_user_id
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$ LANGUAGE SQL;

-- Function to get user's positive rating percentage
CREATE OR REPLACE FUNCTION get_rating_percentage(target_user_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE rating = 'good')::NUMERIC / NULLIF(COUNT(*), 0) * 100),
    100
  )
  FROM user_ratings
  WHERE rated_id = target_user_id;
$$ LANGUAGE SQL;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE user_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mutes ENABLE ROW LEVEL SECURITY;

-- Policies for user_ratings
CREATE POLICY "Users can insert their own ratings" ON user_ratings
  FOR INSERT WITH CHECK (true); -- Allow via service key

CREATE POLICY "Users can read ratings they gave or received" ON user_ratings
  FOR SELECT USING (true); -- Allow via service key

-- Policies for pending_ratings
CREATE POLICY "Service can manage pending ratings" ON pending_ratings
  FOR ALL USING (true); -- Managed by service key

-- Policies for user_reports
CREATE POLICY "Anyone can submit reports" ON user_reports
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service can read reports" ON user_reports
  FOR SELECT USING (true);

-- Policies for user_blocks
CREATE POLICY "Users can manage their blocks" ON user_blocks
  FOR ALL USING (true);

-- Policies for user_suspensions
CREATE POLICY "Service can manage suspensions" ON user_suspensions
  FOR ALL USING (true);

-- Policies for chat_mutes
CREATE POLICY "Service can manage chat mutes" ON chat_mutes
  FOR ALL USING (true);

-- ============================================
-- DONE! 
-- ============================================
-- Tables created:
-- - user_ratings (thumbs up/down + optional feedback)
-- - pending_ratings (for showing rating on next visit)
-- - user_reports (flagging bad behavior)
-- - user_blocks (never match again)
-- - user_suspensions (temp/permanent bans)
-- - chat_mutes (host muting spectators)
-- ============================================
