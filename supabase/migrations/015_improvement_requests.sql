-- Improvement Requests Table
-- Stores improvement/feature requests submitted by users

CREATE TABLE IF NOT EXISTS improvement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'guest',
  user_name TEXT DEFAULT 'Guest',
  user_email TEXT,
  category TEXT NOT NULL DEFAULT 'feature' CHECK (category IN ('feature', 'ui', 'performance', 'mobile', 'accessibility', 'integration', 'other')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  page_url TEXT,
  device_info JSONB DEFAULT '{}',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'under_review', 'planned', 'in_progress', 'completed', 'declined', 'duplicate')),
  admin_notes TEXT,
  votes INTEGER DEFAULT 0,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_improvement_requests_status ON improvement_requests(status);
CREATE INDEX IF NOT EXISTS idx_improvement_requests_category ON improvement_requests(category);
CREATE INDEX IF NOT EXISTS idx_improvement_requests_user_id ON improvement_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_improvement_requests_submitted_at ON improvement_requests(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_improvement_requests_votes ON improvement_requests(votes DESC);

-- Enable Row Level Security
ALTER TABLE improvement_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert improvement requests (users don't need to be authenticated)
CREATE POLICY "Anyone can submit improvement requests" ON improvement_requests
  FOR INSERT
  WITH CHECK (true);

-- Policy: Only service role can read (for admin dashboard)
CREATE POLICY "Service role can read improvement requests" ON improvement_requests
  FOR SELECT
  USING (auth.role() = 'service_role');

-- Policy: Only service role can update (for admin to change status)
CREATE POLICY "Service role can update improvement requests" ON improvement_requests
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_improvement_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER improvement_requests_updated_at
  BEFORE UPDATE ON improvement_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_improvement_requests_updated_at();

COMMENT ON TABLE improvement_requests IS 'Stores improvement and feature requests submitted by users';
COMMENT ON COLUMN improvement_requests.category IS 'Request category: feature, ui, performance, mobile, accessibility, integration, other';
COMMENT ON COLUMN improvement_requests.status IS 'Request status: new, under_review, planned, in_progress, completed, declined, duplicate';
COMMENT ON COLUMN improvement_requests.priority IS 'Priority level: low, normal, high';
COMMENT ON COLUMN improvement_requests.votes IS 'Number of upvotes from other users';
