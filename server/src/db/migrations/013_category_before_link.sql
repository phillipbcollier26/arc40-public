-- 013: remember a row's category when it is linked as a transfer (audit F-02).
-- Linking sets type = 'transfer' and clears the category; type_before_link already kept the old type.
-- category_before_link keeps the old category, so Unlink restores BOTH. Links made before this
-- migration have nothing saved (their category was already cleared), so they restore the type only.
ALTER TABLE transactions ADD COLUMN category_before_link INTEGER REFERENCES categories(id) ON DELETE SET NULL;
