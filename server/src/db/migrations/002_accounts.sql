-- 002: accounts and balance history.
-- `type` is validated in shared/accounts.ts, not here, so new types never need a
-- table rebuild. Money columns enforce typeof = 'integer' so a fractional value
-- can never be stored, even by a bug.

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  institution   TEXT    NOT NULL DEFAULT '' CHECK (length(institution) <= 60),
  type          TEXT    NOT NULL,
  class         TEXT    NOT NULL CHECK (class IN ('asset', 'liability')),
  is_investment INTEGER NOT NULL DEFAULT 0 CHECK (is_investment IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  notes         TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- One balance per account per day. For a liability (future credit cards) the
-- balance is the positive amount owed; net worth subtracts it.
CREATE TABLE balance_snapshots (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of         TEXT    NOT NULL CHECK (as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  balance_cents INTEGER NOT NULL CHECK (typeof(balance_cents) = 'integer'),
  source        TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'computed')),
  note          TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  UNIQUE (account_id, as_of)
);

CREATE INDEX balance_snapshots_by_date ON balance_snapshots (as_of);
