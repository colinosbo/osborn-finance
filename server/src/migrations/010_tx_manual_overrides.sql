-- Per-transaction manual overrides set from the ledger UI:
--   pinned        = the user hand-picked this row's category; a bulk "Re-categorize
--                   all" must NOT overwrite it.
--   manual_refund = the user marked this row as a refund; the refund-netting then
--                   cancels it against an equal-amount earlier charge (any merchant),
--                   so a return labeled differently from the purchase still nets out.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS manual_refund BOOLEAN NOT NULL DEFAULT false;
