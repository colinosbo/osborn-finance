-- Osborn Finance schema v1 (Enterprise Plan §3)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_subject_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',         -- free | personal | family | enterprise
  stripe_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plaid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plaid_item_id TEXT UNIQUE NOT NULL,
  institution_name TEXT,
  access_token_ciphertext TEXT NOT NULL,     -- AES-256-GCM, key in Key Vault
  sync_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'healthy',    -- healthy | login_required | revoked
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES plaid_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plaid_account_id TEXT UNIQUE,
  name TEXT, mask TEXT, type TEXT,
  current_balance NUMERIC(14,2),
  iso_currency TEXT DEFAULT 'USD'
);
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  plaid_transaction_id TEXT UNIQUE,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  merchant TEXT,
  amount NUMERIC(14,2) NOT NULL,             -- negative = outflow
  balance NUMERIC(14,2),
  pending BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL DEFAULT 'Other',
  source TEXT NOT NULL DEFAULT 'csv',        -- csv | plaid
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_user_cat  ON transactions(user_id, category);
CREATE TABLE IF NOT EXISTS category_overrides (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (user_id, merchant_key)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  event TEXT NOT NULL,
  detail TEXT,
  ip_hash TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
