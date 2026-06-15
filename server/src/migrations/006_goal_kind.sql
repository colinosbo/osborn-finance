-- Goals can be savings (grow an asset toward a target) or payoff (pay a debt
-- down to zero). kind is derived from the linked account's type at creation.
-- start_balance records the debt at link time so progress = start - current.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'savings';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS start_balance NUMERIC(14,2);
