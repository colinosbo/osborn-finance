-- Let a savings goal track a specific linked account (e.g. a Chime savings
-- account). When set, the goal's "saved" amount auto-syncs from that account's
-- current balance instead of being logged manually. ON DELETE SET NULL so
-- unlinking a bank simply detaches the goal rather than deleting it.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
