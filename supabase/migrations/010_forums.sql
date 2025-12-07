-- =============================================
-- ChatSpheres Forums System
-- Migration 010: Reddit-style Forums for Video Chats
-- =============================================

-- =============================================
-- FORUMS TABLE (main forums/communities)
-- =============================================
CREATE TABLE IF NOT EXISTS forums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  rules TEXT,
  
  -- Categorization
  category VARCHAR(50) DEFAULT 'other',
  tags TEXT[],
  
  -- Privacy & Type
  forum_type VARCHAR(20) DEFAULT 'public',
  is_nsfw BOOLEAN DEFAULT FALSE,
  
  -- Ownership
  owner_id UUID NOT NULL,
  
  -- Branding (Pro+ features)
  icon_url TEXT,
  banner_url TEXT,
  primary_color VARCHAR(7),
  secondary_color VARCHAR(7),
  
  -- Stats (denormalized for performance)
  member_count INTEGER DEFAULT 0,
  room_count INTEGER DEFAULT 0,
  active_room_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_forums_slug ON forums(slug);
CREATE INDEX IF NOT EXISTS idx_forums_owner ON forums(owner_id);
CREATE INDEX IF NOT EXISTS idx_forums_category ON forums(category);
CREATE INDEX IF NOT EXISTS idx_forums_type ON forums(forum_type);
CREATE INDEX IF NOT EXISTS idx_forums_member_count ON forums(member_count DESC);

-- =============================================
-- FORUM MEMBERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(20) DEFAULT 'member',
  notifications_enabled BOOLEAN DEFAULT TRUE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(forum_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_members_forum ON forum_members(forum_id);
CREATE INDEX IF NOT EXISTS idx_forum_members_user ON forum_members(user_id);

-- =============================================
-- FORUM MODERATORS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_moderators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  added_by UUID NOT NULL,
  can_ban BOOLEAN DEFAULT TRUE,
  can_mute BOOLEAN DEFAULT TRUE,
  can_delete_rooms BOOLEAN DEFAULT TRUE,
  can_pin BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(forum_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_moderators_forum ON forum_moderators(forum_id);
CREATE INDEX IF NOT EXISTS idx_forum_moderators_user ON forum_moderators(user_id);

-- =============================================
-- FORUM BANS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  banned_by UUID NOT NULL,
  reason TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(forum_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_bans_forum ON forum_bans(forum_id);
CREATE INDEX IF NOT EXISTS idx_forum_bans_user ON forum_bans(user_id);

-- =============================================
-- FORUM MUTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  muted_by UUID NOT NULL,
  reason TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(forum_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_mutes_forum ON forum_mutes(forum_id);
CREATE INDEX IF NOT EXISTS idx_forum_mutes_user ON forum_mutes(user_id);

-- =============================================
-- FORUM ANNOUNCEMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  created_by UUID NOT NULL,
  is_pinned BOOLEAN DEFAULT TRUE,
  pin_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_announcements_forum ON forum_announcements(forum_id);

-- =============================================
-- FORUM ROOMS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  room_id VARCHAR(255) NOT NULL,
  room_url TEXT,
  title VARCHAR(200),
  description TEXT,
  host_id UUID NOT NULL,
  host_name VARCHAR(100),
  room_type VARCHAR(20) DEFAULT 'live',
  scheduled_for TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'live',
  peak_viewers INTEGER DEFAULT 0,
  total_tips INTEGER DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(forum_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_rooms_forum ON forum_rooms(forum_id);
CREATE INDEX IF NOT EXISTS idx_forum_rooms_status ON forum_rooms(status);
CREATE INDEX IF NOT EXISTS idx_forum_rooms_room_id ON forum_rooms(room_id);

-- =============================================
-- FORUM EARNINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  room_id VARCHAR(255),
  tip_transaction_id UUID,
  total_tip_amount INTEGER NOT NULL,
  creator_share INTEGER NOT NULL,
  tipper_id UUID NOT NULL,
  host_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_earnings_forum ON forum_earnings(forum_id);
CREATE INDEX IF NOT EXISTS idx_forum_earnings_owner ON forum_earnings(owner_id);

-- =============================================
-- FORUM INVITES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS forum_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  invite_code VARCHAR(20) UNIQUE NOT NULL,
  created_by UUID NOT NULL,
  max_uses INTEGER,
  use_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_invites_code ON forum_invites(invite_code);
CREATE INDEX IF NOT EXISTS idx_forum_invites_forum ON forum_invites(forum_id);

-- =============================================
-- TRIGGERS: Update member count
-- =============================================
CREATE OR REPLACE FUNCTION update_forum_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forums SET member_count = member_count + 1 WHERE id = NEW.forum_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forums SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.forum_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_forum_member_count ON forum_members;
CREATE TRIGGER trigger_update_forum_member_count
AFTER INSERT OR DELETE ON forum_members
FOR EACH ROW EXECUTE FUNCTION update_forum_member_count();

-- =============================================
-- TRIGGERS: Update room count
-- =============================================
CREATE OR REPLACE FUNCTION update_forum_room_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forums SET 
      room_count = room_count + 1,
      active_room_count = active_room_count + CASE WHEN NEW.status = 'live' THEN 1 ELSE 0 END
    WHERE id = NEW.forum_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    UPDATE forums SET 
      active_room_count = active_room_count + 
        CASE WHEN NEW.status = 'live' THEN 1 ELSE 0 END -
        CASE WHEN OLD.status = 'live' THEN 1 ELSE 0 END
    WHERE id = NEW.forum_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forums SET 
      active_room_count = GREATEST(0, active_room_count - CASE WHEN OLD.status = 'live' THEN 1 ELSE 0 END)
    WHERE id = OLD.forum_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_forum_room_count ON forum_rooms;
CREATE TRIGGER trigger_update_forum_room_count
AFTER INSERT OR UPDATE OR DELETE ON forum_rooms
FOR EACH ROW EXECUTE FUNCTION update_forum_room_count();

-- =============================================
-- RLS POLICIES
-- =============================================
ALTER TABLE forums ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_moderators ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_invites ENABLE ROW LEVEL SECURITY;

-- Service role bypass for all tables
CREATE POLICY service_role_bypass_forums ON forums FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_members ON forum_members FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_mods ON forum_moderators FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_bans ON forum_bans FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_mutes ON forum_mutes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_announcements ON forum_announcements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_rooms ON forum_rooms FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_earnings ON forum_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_invites ON forum_invites FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read for public forums
CREATE POLICY forums_public_read ON forums FOR SELECT USING (forum_type = 'public' AND deleted_at IS NULL);

-- =============================================
-- Add forum_revenue transaction type
-- =============================================
ALTER TABLE gem_transactions 
DROP CONSTRAINT IF EXISTS gem_transactions_transaction_type_check;

ALTER TABLE gem_transactions 
ADD CONSTRAINT gem_transactions_transaction_type_check 
CHECK (transaction_type IN (
    'purchase', 'subscription_bonus', 'tip_sent', 'tip_received',
    'entry_fee_paid', 'entry_fee_received', 'refund', 'promo', 
    'cashout', 'pot_contribution', 'pot_winnings', 'forum_revenue'
));
