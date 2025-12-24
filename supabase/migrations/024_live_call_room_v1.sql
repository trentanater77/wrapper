-- =====================================================
-- LIVE CALL ROOM V1 (CREATOR ROOMS)
-- Session duration + queue monetization + per-caller timers + recording metadata + clip marks
-- =====================================================

-- =====================================================
-- 1. EXTEND ACTIVE_ROOMS
-- =====================================================
DO $$
BEGIN
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS session_duration_minutes INTEGER;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS ended_reason TEXT;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS ended_by UUID;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS queue_cleared_at TIMESTAMPTZ;

  -- Track which queue entry is currently active + its timer
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_queue_id UUID;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_time_limit_seconds INTEGER;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS current_challenger_expires_at TIMESTAMPTZ;

  -- Recording (server-side egress)
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS active_recording_id TEXT;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS recording_started_at TIMESTAMPTZ;
  ALTER TABLE active_rooms ADD COLUMN IF NOT EXISTS recording_stopped_at TIMESTAMPTZ;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- =====================================================
-- 2. EXTEND ROOM_QUEUE
-- =====================================================
DO $$
BEGIN
  -- Monetization fields
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS paid_gems INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS paid_minutes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS paid_purchased_at TIMESTAMPTZ;

  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS boost_gems INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS boost_updated_at TIMESTAMPTZ;

  -- Time limit applied when called (seconds)
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER;

  -- Disconnect retry tracking
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS disconnect_retry_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE room_queue ADD COLUMN IF NOT EXISTS last_disconnect_at TIMESTAMPTZ;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_room_queue_paid_order
  ON room_queue(room_id, status, paid_gems DESC, joined_at);

CREATE INDEX IF NOT EXISTS idx_room_queue_boost_order
  ON room_queue(room_id, status, boost_gems DESC, joined_at);

-- =====================================================
-- 3. CLIP MARKS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_room_clip_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  recording_id TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mark_ms BIGINT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_room_clip_marks_room
  ON creator_room_clip_marks(room_id);

ALTER TABLE creator_room_clip_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access creator_room_clip_marks" ON creator_room_clip_marks;
CREATE POLICY "Service role full access creator_room_clip_marks" ON creator_room_clip_marks
  FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- 4. EXTEND GEM TRANSACTION TYPES
-- =====================================================
DO $$
BEGIN
  ALTER TABLE gem_transactions
    DROP CONSTRAINT IF EXISTS gem_transactions_transaction_type_check;

  ALTER TABLE gem_transactions
    ADD CONSTRAINT gem_transactions_transaction_type_check
    CHECK (transaction_type IN (
      'purchase',
      'purchase_bonus',
      'subscription_bonus',
      'referral_bonus',
      'referral_purchase_bonus',
      'referral_subscription_bonus',
      'tip_sent',
      'tip_received',
      'entry_fee_paid',
      'entry_fee_received',
      'refund',
      'promo',
      'cashout',
      'pot_contribution',
      'pot_winnings',
      'forum_revenue',
      'vest',
      'payout_request',
      'payout_completed',
      'payout_rejected',
      'creator_boost',
      'creator_paid_slot',
      'creator_paid_slot_refund'
    ));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;
