-- Rate Limits Table
-- Used by the rate limiter utility to track API request counts

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,              -- Composite key: limit_type:endpoint:identifier
  identifier TEXT NOT NULL,               -- IP address or user ID
  endpoint TEXT DEFAULT 'default',        -- API endpoint name
  limit_type TEXT DEFAULT 'standard',     -- Type of rate limit (standard, strict, auth, etc)
  request_count INTEGER DEFAULT 1,        -- Number of requests in current window
  window_start TIMESTAMPTZ DEFAULT NOW(), -- Start of current rate limit window
  expires_at TIMESTAMPTZ NOT NULL,        -- When this entry expires
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by key
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);

-- Index for cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);

-- Auto-cleanup old rate limit entries (runs on any INSERT/UPDATE)
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete entries that expired more than 5 minutes ago
  -- (keeps some buffer to avoid race conditions)
  DELETE FROM rate_limits 
  WHERE expires_at < NOW() - INTERVAL '5 minutes';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if it doesn't exist
DROP TRIGGER IF EXISTS trigger_cleanup_rate_limits ON rate_limits;
CREATE TRIGGER trigger_cleanup_rate_limits
AFTER INSERT ON rate_limits
FOR EACH STATEMENT
EXECUTE FUNCTION cleanup_expired_rate_limits();

COMMENT ON TABLE rate_limits IS 'Tracks API request counts for rate limiting';
