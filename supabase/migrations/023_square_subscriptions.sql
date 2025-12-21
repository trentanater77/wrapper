ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS square_customer_id TEXT;

ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS square_subscription_id TEXT;

ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS square_plan_variation_id TEXT;

ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS square_subscription_status TEXT;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_square_customer
  ON user_subscriptions(square_customer_id);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_square_subscription
  ON user_subscriptions(square_subscription_id);

ALTER TABLE gem_transactions
ADD COLUMN IF NOT EXISTS square_invoice_id TEXT;

ALTER TABLE gem_transactions
ADD COLUMN IF NOT EXISTS square_subscription_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gem_transactions_square_invoice_id
  ON gem_transactions(square_invoice_id)
  WHERE square_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gem_transactions_square_subscription_id
  ON gem_transactions(square_subscription_id);

CREATE TABLE IF NOT EXISTS square_pending_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL,
  billing_period TEXT CHECK (billing_period IN ('monthly', 'yearly')),
  square_plan_variation_id TEXT NOT NULL,
  square_payment_link_id TEXT NOT NULL,
  square_order_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'activated', 'canceled')),
  square_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_pending_subscriptions_order_id
  ON square_pending_subscriptions(square_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_pending_subscriptions_idempotency
  ON square_pending_subscriptions(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_pending_subscriptions_payment_link
  ON square_pending_subscriptions(square_payment_link_id);

CREATE INDEX IF NOT EXISTS idx_square_pending_subscriptions_user_id
  ON square_pending_subscriptions(user_id);

ALTER TABLE square_pending_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own square pending subscriptions" ON square_pending_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access square pending subscriptions" ON square_pending_subscriptions
  FOR ALL USING (auth.role() = 'service_role');
