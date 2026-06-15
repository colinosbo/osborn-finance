-- Savings goals: user-defined targets ("save $5,000 for a house"). saved_amount
-- is tracked by the user; the API derives on-pace projections at read time from
-- the user's net cash flow, so no computed fields are stored here.
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount NUMERIC(14,2) NOT NULL,
  saved_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_date DATE,                          -- optional deadline
  color TEXT NOT NULL DEFAULT '#7c3aed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
