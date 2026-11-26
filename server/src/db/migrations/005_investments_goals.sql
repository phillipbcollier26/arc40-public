-- 005: fund prices and goals.

CREATE TABLE securities (
  symbol TEXT PRIMARY KEY CHECK (length(symbol) BETWEEN 1 AND 12),
  name   TEXT NOT NULL DEFAULT ''
);

-- Price per share in ten-thousandths of a dollar. 'import' = the price on a Fidelity
-- buy/reinvest row; 'manual' = typed in by the user (wins over an import on the same day).
CREATE TABLE security_prices (
  symbol   TEXT    NOT NULL REFERENCES securities(symbol) ON DELETE CASCADE,
  as_of    TEXT    NOT NULL CHECK (as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  price_e4 INTEGER NOT NULL CHECK (typeof(price_e4) = 'integer' AND price_e4 > 0),
  source   TEXT    NOT NULL CHECK (source IN ('import', 'manual', 'auto')),
  PRIMARY KEY (symbol, as_of)
);

-- Backfill from activity already imported.
INSERT OR IGNORE INTO securities (symbol, name)
  SELECT symbol, MAX(description) FROM investment_activity WHERE symbol <> '' GROUP BY symbol;
INSERT OR IGNORE INTO security_prices (symbol, as_of, price_e4, source)
  SELECT symbol, date, MAX(price_e4), 'import' FROM investment_activity
  WHERE symbol <> '' AND price_e4 IS NOT NULL AND price_e4 > 0 GROUP BY symbol, date;

-- Goals. kind 'custom' = name + target + funding account (progress = that account's balance).
-- The Roth max-out goal is built in (not stored here); its yearly limits live in settings.
CREATE TABLE goals (
  id           INTEGER PRIMARY KEY,
  kind         TEXT    NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom')),
  name         TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  target_cents INTEGER NOT NULL CHECK (typeof(target_cents) = 'integer' AND target_cents > 0),
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  target_date  TEXT, -- optional, for future on-track logic
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at   INTEGER NOT NULL
);
