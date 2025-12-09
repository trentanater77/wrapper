-- Analytics Events Table
-- Simple free analytics tracking

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL DEFAULT 'page_view',
  page TEXT,
  referrer TEXT,
  user_id UUID,
  session_id TEXT,
  ip_hash TEXT,  -- Anonymized IP hash
  country TEXT,
  device_type TEXT,  -- desktop, mobile, tablet
  browser TEXT,
  user_agent TEXT,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON analytics_events(page);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id) WHERE user_id IS NOT NULL;

-- Daily aggregates view for faster reporting
CREATE OR REPLACE VIEW analytics_daily AS
SELECT 
  DATE(created_at) as date,
  event_type,
  page,
  device_type,
  browser,
  country,
  COUNT(*) as event_count,
  COUNT(DISTINCT session_id) as unique_sessions,
  COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) as unique_users
FROM analytics_events
GROUP BY DATE(created_at), event_type, page, device_type, browser, country;

-- Auto-cleanup old analytics data (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_analytics()
RETURNS void AS $$
BEGIN
  DELETE FROM analytics_events 
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE analytics_events IS 'Simple free analytics tracking - page views and events';
