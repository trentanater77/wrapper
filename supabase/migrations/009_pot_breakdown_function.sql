-- =====================================================
-- FIX: Pot Breakdown Function for Red Room Debates
-- 
-- The pot_transactions table has RLS that only allows users
-- to see transactions where they are sender or recipient.
-- This function bypasses RLS so ALL users can see the full
-- pot breakdown for a room during debates.
-- =====================================================

-- SECURITY DEFINER function to get pot breakdown by recipient
-- This allows any user to see the full pot state for a room
-- Returns: recipient_id (UUID), total_amount (INTEGER) for each debater
CREATE OR REPLACE FUNCTION get_pot_breakdown(p_room_id TEXT)
RETURNS TABLE (
    recipient_id UUID,
    total_amount BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pt.recipient_id,
        SUM(pt.amount)::BIGINT as total_amount
    FROM pot_transactions pt
    WHERE pt.room_id = p_room_id 
      AND pt.status = 'held'
    GROUP BY pt.recipient_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also fix the view policy to allow all authenticated users to view
-- pot transactions for transparency during live debates
-- Drop the old restrictive policy and create a more permissive one
DROP POLICY IF EXISTS "Users can view room pot transactions" ON pot_transactions;

-- New policy: Any authenticated user can view pot transactions
-- This allows spectators to see the full scoreboard
CREATE POLICY "Authenticated users can view pot transactions" ON pot_transactions
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Comment explaining the change
COMMENT ON FUNCTION get_pot_breakdown(TEXT) IS 
    'Returns the total tip amount per recipient for a Red Room debate. '
    'Uses SECURITY DEFINER to bypass RLS so all users can see the full pot breakdown.';
