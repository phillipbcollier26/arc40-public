-- 008: split transactions (V2 Phase 2).
--
-- A split divides ONE income or expense transaction into 2 to 50 pieces, each with its own
-- category, amount and note. The transaction itself is never changed: it keeps its full bank
-- amount (so balances, net worth and duplicate detection are untouched) and its original
-- category (restored by "Remove split"). Totals read the pieces instead of the transaction
-- (server/src/lib/totals.ts). The app checks, inside one database transaction, that the pieces
-- add up to the transaction's amount exactly and have its sign.
CREATE TABLE transaction_splits (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  -- Deleting a category leaves the piece uncategorized, like a whole transaction.
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount_cents   INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents <> 0),
  note           TEXT    NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  UNIQUE (transaction_id, position)
);
CREATE INDEX transaction_splits_by_category ON transaction_splits (category_id);
