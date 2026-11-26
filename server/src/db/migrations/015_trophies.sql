-- 015: Trophy Case (Trophies Round 1).
-- The catalog itself lives in code (shared/trophies.ts); this only stores the user's choices and awards.
--
-- trophy_states: one row per trophy key that was ever turned on. NO ROW = Off (so every trophy, including
--   ones added in later rounds, starts Off). trophy_key is the trophy id ('nw.50k') or, for yearly trophies,
--   id:year ('roth.maxed:2026').
--   state   'off' (turned off or taken back), 'on' (watching), 'earned'
--   mode    'history' (Count my history) or 'today' (Start from today: only data from `since` counts)
--   since   the day it was last turned on (YYYY-MM-DD)
--   award   how many times it has been earned; records of the current award are the ones shown
--   earned_on / earned_at / detail: the current award (cleared by Take it back; the log keeps it)
CREATE TABLE trophy_states (
  trophy_key   TEXT    PRIMARY KEY CHECK (length(trophy_key) BETWEEN 1 AND 80),
  state        TEXT    NOT NULL CHECK (state IN ('off', 'on', 'earned')),
  mode         TEXT    NOT NULL CHECK (mode IN ('history', 'today')),
  since        TEXT    NOT NULL,
  turned_on_at INTEGER NOT NULL,
  award        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(award) = 'integer' AND award >= 0),
  earned_on    TEXT,
  earned_at    INTEGER,
  detail       TEXT,
  updated_at   INTEGER NOT NULL,
  CHECK ((state = 'earned') = (earned_on IS NOT NULL))
);

-- Record plaques: every record of an award (newest shown, older ones struck through). Rows are only added.
CREATE TABLE trophy_records (
  trophy_key   TEXT    NOT NULL,
  award        INTEGER NOT NULL CHECK (typeof(award) = 'integer'),
  period       TEXT    NOT NULL,  -- 'YYYY-MM' for a month end record, 'YYYY' for a year record
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  set_on       TEXT    NOT NULL,  -- the day the record was set (that month end / Dec 31)
  PRIMARY KEY (trophy_key, award, period)
);

-- Everything that ever happened to a trophy (turned on, earned, taken back, turned off, new record).
-- Nothing is ever deleted: Take it back keeps the award here.
CREATE TABLE trophy_log (
  id         INTEGER PRIMARY KEY,
  trophy_key TEXT    NOT NULL,
  action     TEXT    NOT NULL CHECK (action IN ('turn_on', 'earned', 'take_back', 'turn_off', 'record')),
  mode       TEXT,
  on_date    TEXT,
  detail     TEXT,
  at         INTEGER NOT NULL
);
CREATE INDEX trophy_log_key ON trophy_log (trophy_key, id);
