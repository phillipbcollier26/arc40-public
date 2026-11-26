-- 007: category roles (so renaming a category never breaks a total) and remembered
-- answers for Fidelity history actions Arc40 does not recognize.

-- A hidden role on the categories some totals depend on. Before this, the Roth earned-income
-- reference, the refereeing card, the payer chart and the gig set-aside found them BY NAME,
-- so renaming "Refereeing" silently zeroed them. Backfilled from today's names.
ALTER TABLE categories ADD COLUMN role TEXT
  CHECK (role IS NULL OR role IN ('refereeing', 'other_income', 'ref_costs'));
UPDATE categories SET role = 'refereeing'   WHERE name = 'Refereeing'      COLLATE NOCASE AND kind = 'income';
UPDATE categories SET role = 'other_income' WHERE name = 'Other Income'    COLLATE NOCASE AND kind = 'income';
UPDATE categories SET role = 'ref_costs'    WHERE name = 'Ref Gear & Fees' COLLATE NOCASE AND kind = 'expense';
CREATE UNIQUE INDEX categories_by_role ON categories (role) WHERE role IS NOT NULL;

-- The user's answer for a Fidelity action Arc40 does not know. action_key is the action text
-- upper-cased, spaces collapsed, and any long digit run (a possible account number) masked.
--   transfer_in  = money put in        transfer_out = money taken out
--   growth       = the cash is growth (kept as 'other' activity)
--   ignore       = the row is not imported
CREATE TABLE fidelity_action_rules (
  action_key TEXT    PRIMARY KEY CHECK (length(action_key) BETWEEN 1 AND 300),
  treat_as   TEXT    NOT NULL CHECK (treat_as IN ('transfer_in', 'transfer_out', 'growth', 'ignore')),
  updated_at INTEGER NOT NULL
);
