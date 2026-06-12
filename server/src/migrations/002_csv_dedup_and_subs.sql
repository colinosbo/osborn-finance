-- BUG-2: CSV rows have NULL plaid_transaction_id; NULLs never conflict.
-- Partial unique index makes re-imports idempotent at the database layer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_csv_dedup
  ON transactions(user_id, date, amount, name)
  WHERE plaid_transaction_id IS NULL;
