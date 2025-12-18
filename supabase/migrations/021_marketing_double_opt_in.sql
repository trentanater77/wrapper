ALTER TABLE marketing_subscribers
  ADD COLUMN IF NOT EXISTS confirm_token TEXT;

ALTER TABLE marketing_subscribers
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE marketing_subscribers
  ADD COLUMN IF NOT EXISTS optin_requested_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  ALTER TABLE marketing_subscribers DROP CONSTRAINT IF EXISTS marketing_subscribers_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE marketing_subscribers
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE marketing_subscribers
  ADD CONSTRAINT marketing_subscribers_status_check
  CHECK (status IN ('pending', 'subscribed', 'unsubscribed'));

UPDATE marketing_subscribers
SET confirmed_at = COALESCE(confirmed_at, subscribed_at, NOW())
WHERE status = 'subscribed'
  AND confirmed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_subscribers_confirm_token_unique
  ON marketing_subscribers(confirm_token)
  WHERE confirm_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_confirmed_at
  ON marketing_subscribers(confirmed_at);
