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
  'payout_rejected'
));

ALTER TABLE gem_transactions
DROP CONSTRAINT IF EXISTS gem_transactions_wallet_type_check;

ALTER TABLE gem_transactions
ADD CONSTRAINT gem_transactions_wallet_type_check
CHECK (wallet_type IN ('spendable', 'cashable', 'pending_referral'));

ALTER TABLE gem_transactions
ADD COLUMN IF NOT EXISTS square_payment_id TEXT;

ALTER TABLE gem_transactions
ADD COLUMN IF NOT EXISTS square_order_id TEXT;

CREATE TABLE IF NOT EXISTS square_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE square_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access square_events" ON square_events
  FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS square_pending_gem_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gem_pack_key TEXT NOT NULL,
  gems INTEGER NOT NULL CHECK (gems > 0),
  square_payment_link_id TEXT NOT NULL,
  square_order_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled')),
  square_payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_pending_gem_purchases_order_id
  ON square_pending_gem_purchases(square_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_pending_gem_purchases_idempotency
  ON square_pending_gem_purchases(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_pending_gem_purchases_payment_id
  ON square_pending_gem_purchases(square_payment_id)
  WHERE square_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_square_pending_gem_purchases_user_id
  ON square_pending_gem_purchases(user_id);

ALTER TABLE square_pending_gem_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own square pending gem purchases" ON square_pending_gem_purchases
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access square pending gem purchases" ON square_pending_gem_purchases
  FOR ALL USING (auth.role() = 'service_role');
