-- 010: fund prices from every source kept side by side, and remembered Fidelity account names (V2 Phase 2).
--
-- Before this, security_prices held ONE price per fund per day and a price typed by hand won.
-- The user asked for prices from files to win instead, and the emergency "Edit price" must not erase a
-- file price (deleting the edit brings the file price back). So every source keeps its own row and the
-- price used for a day is the best source available (server/src/lib/prices.ts):
--   history (price history file) > positions (Fidelity positions file) > trade (Fidelity history
--   buy/reinvest price) > manual (typed in)
CREATE TABLE price_points (
  symbol     TEXT    NOT NULL REFERENCES securities(symbol) ON DELETE CASCADE,
  as_of      TEXT    NOT NULL CHECK (as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source     TEXT    NOT NULL CHECK (source IN ('history', 'positions', 'trade', 'manual')),
  price_e4   INTEGER NOT NULL CHECK (typeof(price_e4) = 'integer' AND price_e4 > 0),
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, as_of, source)
);
INSERT INTO price_points (symbol, as_of, source, price_e4)
  SELECT symbol, as_of, CASE source WHEN 'manual' THEN 'manual' ELSE 'trade' END, price_e4 FROM security_prices;
-- Prices typed in on a day a Fidelity buy also happened were stored as 'manual' over the trade price;
-- bring the trade price back from the activity so both are kept.
INSERT OR IGNORE INTO price_points (symbol, as_of, source, price_e4)
  SELECT symbol, date, 'trade', MAX(price_e4) FROM investment_activity
  WHERE symbol <> '' AND price_e4 IS NOT NULL AND price_e4 > 0 AND source = 'import' GROUP BY symbol, date;
DROP TABLE security_prices;

-- Fidelity positions files name each account ("ROTH IRA", "Individual"). The first time, the user
-- picks which Arc40 account each name is; later imports remember it. Account NUMBERS are never stored.
CREATE TABLE fidelity_account_names (
  name_key   TEXT    PRIMARY KEY CHECK (length(name_key) BETWEEN 1 AND 80),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
);
