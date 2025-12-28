INSERT INTO creator_program_invites (code, max_uses, uses_count, active)
VALUES ('FOUNDING24', 300, 0, true)
ON CONFLICT (code)
DO UPDATE SET
  max_uses = EXCLUDED.max_uses,
  active = EXCLUDED.active,
  updated_at = NOW();
