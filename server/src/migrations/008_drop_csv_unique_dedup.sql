-- CSV import dedup moved from the database to the application (count-aware, see
-- store.txCounts + the import handler). The old partial unique index treated any
-- two rows with the same (user_id, date, amount, name) as duplicates, which wrongly
-- dropped legitimate same-day identical purchases (e.g. two $3.50 coffees). Drop it;
-- the importer now keeps existing rows from re-imports while allowing real repeats.
DROP INDEX IF EXISTS idx_tx_csv_dedup;
