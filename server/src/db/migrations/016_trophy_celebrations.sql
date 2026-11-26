-- 016: Trophies Round 2, "celebrated once".
-- Each award of a trophy gets the full-screen unlock pop-up exactly once. trophy_states.award counts how many times a
-- trophy has been earned (Take it back keeps the count, so earning it again is a NEW award); celebrated_award is the
-- newest award that has been shown. A trophy is waiting to be celebrated when it is earned and award > celebrated_award.
-- A tab claims the waiting awards with one conditional UPDATE just before it shows them, so two tabs never both show
-- the same award, and an award that was never shown (the browser closed first) is still waiting next time.
--
-- Awards that already exist are marked celebrated, so updating Arc40 does not replay every Round 1 trophy.
-- Note: trophy_records.period also holds 'YYYY-MM-DD' since Round 2 (Best day ever records one day).
ALTER TABLE trophy_states ADD COLUMN celebrated_award INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(celebrated_award) = 'integer' AND celebrated_award >= 0);

UPDATE trophy_states SET celebrated_award = award;
