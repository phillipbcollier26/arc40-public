-- 004: monthly spending limits per category.
-- month = '*' is the default limit used for every month; 'YYYY-MM-01' overrides one month.
CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month       TEXT    NOT NULL CHECK (month = '*' OR month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-01'),
  limit_cents INTEGER NOT NULL CHECK (typeof(limit_cents) = 'integer' AND limit_cents >= 0),
  updated_at  INTEGER NOT NULL,
  UNIQUE (category_id, month)
);

-- Housing and Food exist with a $0 limit (set a limit on the Budget page when you pay them yourself).
INSERT INTO budgets (category_id, month, limit_cents, updated_at)
SELECT id, '*', 0, 0 FROM categories WHERE name IN ('Housing', 'Food');
