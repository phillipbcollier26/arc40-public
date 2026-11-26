-- 017: Trophies Round 3, the Interest category found by role (never by name).
-- The lifetime interest trophies add up income in the Interest category. Renaming a category must never break a
-- trophy, so the category is marked once here (by its built-in name, like migration 007 did for Refereeing) and found
-- by this mark from then on. The existing `role` column only allows three values and changing its CHECK would mean
-- rebuilding the categories table, so the mark is its own small column. At most one category has it.
-- Deleting the category removes the mark with it; the interest trophies then say so instead of guessing.
ALTER TABLE categories ADD COLUMN interest_role INTEGER NOT NULL DEFAULT 0
  CHECK (interest_role IN (0, 1));

UPDATE categories SET interest_role = 1
  WHERE id = (SELECT id FROM categories WHERE name = 'Interest' COLLATE NOCASE AND kind = 'income' ORDER BY id LIMIT 1);

CREATE UNIQUE INDEX categories_by_interest_role ON categories (interest_role) WHERE interest_role = 1;
