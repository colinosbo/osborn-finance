-- Investment tracking: periodic balance snapshots so we can show change-in-value
-- over a reporting window. Captured on the 1st, 15th, and last day of each month
-- (and opportunistically on any sync). One row per account per day.
CREATE TABLE IF NOT EXISTS account_balance_snapshots (
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  balance     NUMERIC(14,2) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, date)
);
CREATE INDEX IF NOT EXISTS idx_snap_user_acct_date ON account_balance_snapshots(user_id, account_id, date);
