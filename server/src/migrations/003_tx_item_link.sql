-- FIX: unlinking a bank left its transactions behind (they still showed in the
-- ledger/summary). Link each transaction to its Plaid item so removing the item
-- cascades the cleanup. New plaid transactions populate item_id on sync; CSV rows
-- keep it NULL (not tied to a bank).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES plaid_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tx_item ON transactions(item_id);
