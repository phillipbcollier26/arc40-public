-- 012: work cost jobs (V2 Phase 3). The user's other jobs, used to show what spending costs in hours of work.
-- Personal data: lives only in this database (demo mode has its own fake jobs). Pay is before taxes.
--   pay_kind 'hourly': pay_cents = pay per hour
--   pay_kind 'salary': pay_cents = pay per year; hourly = salary / 2,080 hours (40 h x 52 weeks), never stored
-- Pay per refereeing game and which pay to use are settings (ref_pay_per_game_cents, work_cost_selection).
CREATE TABLE work_jobs (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  pay_kind   TEXT    NOT NULL CHECK (pay_kind IN ('hourly', 'salary')),
  pay_cents  INTEGER NOT NULL CHECK (typeof(pay_cents) = 'integer' AND pay_cents > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
