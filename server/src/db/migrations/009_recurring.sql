-- 009: recurring charges and subscriptions (V2 Phase 2).
--
-- Only the user's DECISIONS are stored. Suggestions are worked out fresh from transactions every
-- time (server/src/lib/recurring.ts), so nothing here can drift from the transactions, and
-- importing never writes to these tables.

-- A confirmed or manually added recurring expense, or one the user cancelled.
CREATE TABLE recurring_items (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- Detected items: the merchant key their charges are matched by. Manual items: NULL.
  merchant_key TEXT CHECK (merchant_key IS NULL OR length(merchant_key) BETWEEN 1 AND 120),
  -- Detected: the amount when confirmed (used to find its charges; the newest charge is shown).
  -- Manual: the amount the user typed. Positive cents = what one charge costs.
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  schedule     TEXT    NOT NULL CHECK (schedule IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  -- A due date the schedule counts from. Correcting "next due" moves it.
  anchor_date  TEXT    NOT NULL CHECK (anchor_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Only set when two same-price series from one merchant are told apart by billing day.
  billing_day  INTEGER CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31),
  -- NULL = use the category of the newest charge.
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  source       TEXT    NOT NULL CHECK (source IN ('detected', 'manual')),
  cancelled_on TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Suggestions the user dismissed. A later suggestion from the same merchant at a nearby amount
-- (and, when set, the same billing day) stays dismissed.
CREATE TABLE recurring_dismissals (
  id           INTEGER PRIMARY KEY,
  merchant_key TEXT    NOT NULL CHECK (length(merchant_key) BETWEEN 1 AND 120),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  billing_day  INTEGER CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31),
  name         TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
