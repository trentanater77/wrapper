-- =====================================================
-- ADD FORUM ASSOCIATION TO SCHEDULED EVENTS
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add forum columns to scheduled_events table
ALTER TABLE scheduled_events ADD COLUMN IF NOT EXISTS forum_id UUID;
ALTER TABLE scheduled_events ADD COLUMN IF NOT EXISTS forum_slug TEXT;
ALTER TABLE scheduled_events ADD COLUMN IF NOT EXISTS forum_name TEXT;

-- Create index for forum lookups
CREATE INDEX IF NOT EXISTS idx_scheduled_events_forum_id ON scheduled_events(forum_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_forum_slug ON scheduled_events(forum_slug);

-- Also add to active_rooms for when events go live
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS forum_id UUID;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS forum_slug TEXT;
ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS forum_name TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_active_rooms_forum_id ON active_rooms(forum_id);
CREATE INDEX IF NOT EXISTS idx_active_rooms_forum_slug ON active_rooms(forum_slug);

SELECT 'Migration complete! Added forum columns to scheduled_events and active_rooms' as status;
