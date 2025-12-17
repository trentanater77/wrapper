-- =====================================================
-- EMAIL REMINDERS (T-10 + LIVE) + MARKETING SUBSCRIBERS
-- Run this in Supabase SQL Editor
-- =====================================================

ALTER TABLE event_reminders ADD COLUMN IF NOT EXISTS sent_tminus10_at TIMESTAMPTZ;
ALTER TABLE event_reminders ADD COLUMN IF NOT EXISTS sent_live_at TIMESTAMPTZ;

ALTER TABLE event_reminders ALTER COLUMN notify_email SET DEFAULT true;

UPDATE event_reminders
SET notify_email = true
WHERE notify_browser = true
  AND notify_email = false;

CREATE INDEX IF NOT EXISTS idx_event_reminders_notify_email ON event_reminders(notify_email);
CREATE INDEX IF NOT EXISTS idx_event_reminders_sent_tminus10_at ON event_reminders(sent_tminus10_at);
CREATE INDEX IF NOT EXISTS idx_event_reminders_sent_live_at ON event_reminders(sent_live_at);

CREATE TABLE IF NOT EXISTS marketing_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'unsubscribed')),
    unsubscribe_token TEXT NOT NULL UNIQUE,
    source TEXT,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    unsubscribed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
    ALTER TABLE marketing_subscribers ADD CONSTRAINT marketing_subscribers_email_unique UNIQUE(email);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_status ON marketing_subscribers(status);

ALTER TABLE marketing_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage marketing subscribers" ON marketing_subscribers;
CREATE POLICY "Service role can manage marketing subscribers" ON marketing_subscribers FOR ALL
USING (auth.role() = 'service_role');
