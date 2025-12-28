-- =====================================================
-- CREATOR PROGRAM INVITES (FOUNDING COHORT)
-- =====================================================

CREATE TABLE IF NOT EXISTS creator_program_invites (
  code TEXT PRIMARY KEY,
  max_uses INTEGER NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
  uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_program_invite_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL REFERENCES creator_program_invites(code) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id),
  UNIQUE(code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_program_invite_redemptions_code
  ON creator_program_invite_redemptions(code);

CREATE INDEX IF NOT EXISTS idx_creator_program_invite_redemptions_user
  ON creator_program_invite_redemptions(user_id);

ALTER TABLE creator_program_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_program_invite_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access creator program invites" ON creator_program_invites;
CREATE POLICY "Service role full access creator program invites" ON creator_program_invites
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access creator program redemptions" ON creator_program_invite_redemptions;
CREATE POLICY "Service role full access creator program redemptions" ON creator_program_invite_redemptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION redeem_creator_program_invite(p_user_id UUID, p_code TEXT)
RETURNS JSONB
AS $$
DECLARE
  v_invite creator_program_invites%ROWTYPE;
  v_existing UUID;
  v_now TIMESTAMPTZ := NOW();
  v_expiry TIMESTAMPTZ := TIMESTAMPTZ '2099-12-31 23:59:59+00';
BEGIN
  IF p_user_id IS NULL OR p_code IS NULL OR LENGTH(TRIM(p_code)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  SELECT *
    INTO v_invite
    FROM creator_program_invites
    WHERE code = TRIM(p_code)
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  IF v_invite.active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false, 'error', 'inactive_code');
  END IF;

  SELECT id
    INTO v_existing
    FROM creator_program_invite_redemptions
    WHERE user_id = p_user_id
    LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_redeemed', 'code', v_invite.code);
  END IF;

  IF v_invite.uses_count >= v_invite.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'cohort_full', 'code', v_invite.code);
  END IF;

  INSERT INTO creator_program_invite_redemptions(code, user_id, redeemed_at)
  VALUES (v_invite.code, p_user_id, v_now);

  UPDATE creator_program_invites
    SET uses_count = uses_count + 1,
        updated_at = v_now
    WHERE code = v_invite.code;

  INSERT INTO creator_partners (user_id, status, tip_share_percent, tier, approved_at, created_at, updated_at)
  VALUES (p_user_id, 'active', 100, 'founding', v_now, v_now, v_now)
  ON CONFLICT (user_id)
  DO UPDATE SET
    status = 'active',
    tip_share_percent = 100,
    tier = 'founding',
    approved_at = v_now,
    updated_at = v_now;

  INSERT INTO user_subscriptions (
    user_id,
    plan_type,
    billing_period,
    status,
    current_period_start,
    current_period_end,
    canceled_at,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    'host_pro',
    NULL,
    'active',
    v_now,
    v_expiry,
    NULL,
    v_now,
    v_now
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan_type = 'host_pro',
    status = 'active',
    current_period_start = v_now,
    current_period_end = v_expiry,
    canceled_at = NULL,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'redeemed',
    'code', v_invite.code,
    'maxUses', v_invite.max_uses
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

INSERT INTO creator_program_invites (code, max_uses, uses_count, active)
VALUES ('FOUNDING24', 300, 0, true)
ON CONFLICT (code)
DO UPDATE SET
  max_uses = EXCLUDED.max_uses,
  active = EXCLUDED.active,
  updated_at = NOW();
