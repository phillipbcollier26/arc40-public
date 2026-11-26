-- 003: categories, transactions, rules, CSV mappings, import batches, investment activity.

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
  group_name TEXT    NOT NULL DEFAULT 'Other' CHECK (length(group_name) BETWEEN 1 AND 40),
  kind       TEXT    NOT NULL CHECK (kind IN ('expense', 'income')),
  color      TEXT    NOT NULL DEFAULT 'silver', -- a token name from tokens.css, never a raw color
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE import_batches (
  id             INTEGER PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  filename       TEXT    NOT NULL,
  file_sha256    TEXT    NOT NULL,
  format         TEXT    NOT NULL, -- 'generic' | 'fidelity'
  rows_total     INTEGER NOT NULL,
  rows_imported  INTEGER NOT NULL,
  rows_duplicate INTEGER NOT NULL,
  rows_skipped   INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);

-- amount_cents is signed: positive = money into the account, negative = money out.
-- type rules (enforced in server/src/lib/transactions.ts):
--   income / expense: category_id is an income / expense category, or NULL (= uncategorized)
--   transfer / gift:  category_id is NULL
CREATE TABLE transactions (
  id                INTEGER PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date              TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_cents      INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  description       TEXT    NOT NULL,          -- cleaned, shown in the UI, editable
  raw_description   TEXT    NOT NULL DEFAULT '', -- exactly what the bank sent; rules match on this too
  type              TEXT    NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'gift')),
  category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  gift_from         TEXT    NOT NULL DEFAULT '',
  payer             TEXT    NOT NULL DEFAULT '', -- who paid you (gig income), optional
  notes             TEXT    NOT NULL DEFAULT '',
  transfer_group_id INTEGER,                     -- both legs of a transfer share this
  type_before_link  TEXT,                        -- restored if an automatic transfer link is undone
  source            TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  import_batch_id   INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
  dedupe_key        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX transactions_by_date ON transactions (date);
CREATE INDEX transactions_by_account ON transactions (account_id, date);
CREATE INDEX transactions_by_dedupe ON transactions (account_id, dedupe_key);
CREATE INDEX transactions_by_transfer ON transactions (transfer_group_id);

-- "If the description contains X, set category/type". Plain text matching only
-- (contains / starts_with / equals, case-insensitive), never user regex.
CREATE TABLE category_rules (
  id              INTEGER PRIMARY KEY,
  match_type      TEXT    NOT NULL CHECK (match_type IN ('contains', 'starts_with', 'equals')),
  pattern         TEXT    NOT NULL CHECK (length(pattern) BETWEEN 1 AND 100),
  account_id      INTEGER REFERENCES accounts(id) ON DELETE CASCADE, -- NULL = any account
  direction       TEXT    NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'in', 'out')),
  set_type        TEXT    CHECK (set_type IN ('income', 'expense', 'transfer', 'gift')),
  set_category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  set_gift_from   TEXT    NOT NULL DEFAULT '',
  priority        INTEGER NOT NULL DEFAULT 0, -- lower runs first; your rules (0) beat built-in ones (100)
  created_at      INTEGER NOT NULL,
  CHECK (set_type IS NOT NULL OR set_category_id IS NOT NULL)
);

-- One saved column mapping per account (format + JSON config).
CREATE TABLE csv_mappings (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  format     TEXT    NOT NULL,
  config     TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Brokerage/IRA activity (Fidelity). Buys/reinvestments build share counts in Milestone 5.
-- Contributions carry the tax year they count toward.
CREATE TABLE investment_activity (
  id              INTEGER PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date            TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('contribution', 'transfer_in', 'transfer_out', 'buy', 'sell',
                                                   'reinvest', 'dividend', 'interest', 'fee', 'other')),
  symbol          TEXT    NOT NULL DEFAULT '',
  description     TEXT    NOT NULL DEFAULT '',
  quantity_micro  INTEGER NOT NULL DEFAULT 0 CHECK (typeof(quantity_micro) = 'integer'), -- shares x 1,000,000
  price_e4        INTEGER CHECK (price_e4 IS NULL OR typeof(price_e4) = 'integer'),     -- dollars x 10,000
  amount_cents    INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  tax_year        INTEGER,
  raw_action      TEXT    NOT NULL DEFAULT '',
  source          TEXT    NOT NULL DEFAULT 'import' CHECK (source IN ('manual', 'import')),
  import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
  dedupe_key      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX investment_activity_by_account ON investment_activity (account_id, date);

-- Balances can now come from an import's running-balance column (undo removes them).
ALTER TABLE balance_snapshots ADD COLUMN import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE;

-- ---------- Default categories (editable) ----------
INSERT INTO categories (name, group_name, kind, color, sort_order, created_at) VALUES
  ('Refereeing',       'Income',      'income',  'gold',     1, 0),
  ('Interest',         'Income',      'income',  'sage',     2, 0),
  ('Other Income',     'Income',      'income',  'platinum', 3, 0),
  ('Housing',          'Essentials',  'expense', 'bronze',  10, 0),
  ('Food',             'Essentials',  'expense', 'copper',  11, 0),
  ('Utilities',        'Essentials',  'expense', 'pewter',  12, 0),
  ('Phone & Internet', 'Essentials',  'expense', 'silver',  13, 0),
  ('Transportation',   'Essentials',  'expense', 'bronze',  14, 0),
  ('Health',           'Essentials',  'expense', 'sage',    15, 0),
  ('Dining Out',       'Lifestyle',   'expense', 'copper',  20, 0),
  ('Entertainment',    'Lifestyle',   'expense', 'gold',    21, 0),
  ('Shopping',         'Lifestyle',   'expense', 'silver',  22, 0),
  ('Subscriptions',    'Lifestyle',   'expense', 'platinum',23, 0),
  ('Personal Care',    'Lifestyle',   'expense', 'pewter',  24, 0),
  ('Travel',           'Lifestyle',   'expense', 'gold',    25, 0),
  ('Education',        'School',      'expense', 'silver',  30, 0),
  ('Ref Gear & Fees',  'Refereeing',  'expense', 'gold',    40, 0),
  ('Gifts Given',      'Other',       'expense', 'bronze',  50, 0),
  ('Fees & Charges',   'Other',       'expense', 'garnet',  51, 0),
  ('Miscellaneous',    'Other',       'expense', 'pewter',  52, 0);

-- ---------- Built-in rules (priority 100, editable/deletable) ----------
INSERT INTO category_rules (match_type, pattern, direction, set_type, set_category_id, priority, created_at)
SELECT 'contains', p.pattern, p.direction, p.set_type, c.id, 100, 0
FROM (
  SELECT 'INTEREST' AS pattern, 'in' AS direction, 'income' AS set_type, 'Interest' AS cat UNION ALL
  SELECT 'DIVIDEND', 'in', 'income', 'Interest' UNION ALL
  SELECT 'SPOTIFY', 'out', 'expense', 'Subscriptions' UNION ALL
  SELECT 'NETFLIX', 'out', 'expense', 'Subscriptions' UNION ALL
  SELECT 'HULU', 'out', 'expense', 'Subscriptions' UNION ALL
  SELECT 'APPLE.COM/BILL', 'out', 'expense', 'Subscriptions' UNION ALL
  SELECT 'KROGER', 'out', 'expense', 'Food' UNION ALL
  SELECT 'ALDI', 'out', 'expense', 'Food' UNION ALL
  SELECT 'MEIJER', 'out', 'expense', 'Food' UNION ALL
  SELECT 'PARKING', 'out', 'expense', 'Transportation' UNION ALL
  SELECT 'SPEEDWAY', 'out', 'expense', 'Transportation' UNION ALL
  SELECT 'UBER EATS', 'out', 'expense', 'Dining Out' UNION ALL
  SELECT 'DOORDASH', 'out', 'expense', 'Dining Out' UNION ALL
  SELECT 'CHIPOTLE', 'out', 'expense', 'Dining Out' UNION ALL
  SELECT 'MCDONALD', 'out', 'expense', 'Dining Out' UNION ALL
  SELECT 'CLINIC', 'out', 'expense', 'Health' UNION ALL
  SELECT 'PHARMACY', 'out', 'expense', 'Health'
) p JOIN categories c ON c.name = p.cat;

-- Zelle can be paying a friend or getting paid, so it beats the generic TRANSFER rule.
INSERT INTO category_rules (match_type, pattern, direction, set_type, priority, created_at) VALUES
  ('contains', 'ZELLE', 'out', 'expense', 90, 0),
  ('contains', 'ZELLE', 'in', 'income', 90, 0),
  ('contains', 'TRANSFER', 'any', 'transfer', 100, 0);
