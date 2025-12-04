-- Bug Reports Table
-- Stores bug reports submitted by users (participants and spectators)

CREATE TABLE IF NOT EXISTS bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'guest',
  user_name TEXT DEFAULT 'Guest',
  user_email TEXT,
  room_id TEXT,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('video', 'audio', 'connection', 'chat', 'ui', 'performance', 'other')),
  description TEXT NOT NULL,
  device_info JSONB DEFAULT '{}',
  page_url TEXT,
  is_spectator BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'closed', 'duplicate')),
  admin_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  reported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_category ON bug_reports(category);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user_id ON bug_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_reported_at ON bug_reports(reported_at DESC);

-- Enable Row Level Security
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert bug reports (users don't need to be authenticated)
CREATE POLICY "Anyone can submit bug reports" ON bug_reports
  FOR INSERT
  WITH CHECK (true);

-- Policy: Only service role can read (for admin dashboard)
CREATE POLICY "Service role can read bug reports" ON bug_reports
  FOR SELECT
  USING (auth.role() = 'service_role');

-- Policy: Only service role can update (for admin to change status)
CREATE POLICY "Service role can update bug reports" ON bug_reports
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_bug_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bug_reports_updated_at
  BEFORE UPDATE ON bug_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_bug_reports_updated_at();

-- Also ensure muted_chat_users table exists (for mute functionality)
CREATE TABLE IF NOT EXISTS muted_chat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  muted_user_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, muted_user_id)
);

-- Index for muted users lookup
CREATE INDEX IF NOT EXISTS idx_muted_chat_users_room ON muted_chat_users(room_id);

-- Enable RLS for muted_chat_users
ALTER TABLE muted_chat_users ENABLE ROW LEVEL SECURITY;

-- Anyone can read muted users (to check if they're muted)
CREATE POLICY "Anyone can read muted users" ON muted_chat_users
  FOR SELECT
  USING (true);

-- Service role can insert/update/delete muted users
CREATE POLICY "Service role can manage muted users" ON muted_chat_users
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE bug_reports IS 'Stores bug reports submitted by users from the video chat interface';
COMMENT ON COLUMN bug_reports.category IS 'Bug category: video, audio, connection, chat, ui, performance, other';
COMMENT ON COLUMN bug_reports.status IS 'Report status: new, in_progress, resolved, closed, duplicate';
COMMENT ON COLUMN bug_reports.device_info IS 'JSON object containing browser, platform, screen size, etc.';
