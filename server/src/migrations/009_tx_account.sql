-- Internal-transfer netting needs to know which account a transaction belongs to,
-- so we can net a transfer only when its two legs are in two DIFFERENT accounts
-- the user actually has. CSV imports populate this from the file's Account column;
-- Plaid sync populates it from the linked account's name. Nullable: older rows and
-- single-account CSVs simply aren't eligible for netting.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account TEXT;
