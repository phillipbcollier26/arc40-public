-- 014: one-time repair of who "owns" an imported balance (audit F-01).
-- Before the fix, re-importing a file moved the balances an earlier import recorded onto the newer import,
-- so undoing the newer import deleted them. This hands each imported balance back to the OLDEST import of
-- the same account that still exists and covers that date (its imported transactions start on or before
-- the date and end on or after it). Only the owner changes: no amount, date or transaction is touched.
-- Balances with no older covering import keep their owner. Balances already lost cannot come back here;
-- re-importing the original file restores them.
UPDATE balance_snapshots
SET import_batch_id = (
  SELECT MIN(b.id) FROM import_batches b
  WHERE b.account_id = balance_snapshots.account_id
    AND (SELECT MIN(t.date) FROM transactions t WHERE t.import_batch_id = b.id) <= balance_snapshots.as_of
    AND (SELECT MAX(t.date) FROM transactions t WHERE t.import_batch_id = b.id) >= balance_snapshots.as_of
)
WHERE source = 'import'
  AND import_batch_id IS NOT NULL
  AND (
    SELECT MIN(b.id) FROM import_batches b
    WHERE b.account_id = balance_snapshots.account_id
      AND (SELECT MIN(t.date) FROM transactions t WHERE t.import_batch_id = b.id) <= balance_snapshots.as_of
      AND (SELECT MAX(t.date) FROM transactions t WHERE t.import_batch_id = b.id) >= balance_snapshots.as_of
  ) < import_batch_id;
