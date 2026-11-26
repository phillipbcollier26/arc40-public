-- 018: the activity log and saved goal milestones (Trophies Round 4).
--
-- activity_log remembers three things Arc40 did not keep before, so trophies can count them:
--   backup     each backup made: weekly automatic, Back up now, the safety backup before an update, the safety
--              backup before an account is deleted (backup_kind)
--   wrapped    each time a year's Arc40 Wrapped was watched to its last slide (year = the year watched)
--   positions  each saved Fidelity positions import (all_matched = 1 when every share count matched)
-- Dates, kinds and yes/no results only: never a file name, a path, an account name or a number from a file.
-- It starts empty: it only knows about things from the day it ships (setting activity_log_since).
CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('backup', 'wrapped', 'positions')),
  on_date     TEXT    NOT NULL CHECK (on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  at          INTEGER NOT NULL,
  backup_kind TEXT    CHECK (backup_kind IN ('weekly', 'manual', 'before_update', 'before_delete')),
  year        INTEGER CHECK (year BETWEEN 2000 AND 2100),
  all_matched INTEGER CHECK (all_matched IN (0, 1)),
  CHECK ((kind = 'backup') = (backup_kind IS NOT NULL)),
  CHECK ((kind = 'wrapped') = (year IS NOT NULL)),
  CHECK ((kind = 'positions') = (all_matched IS NOT NULL))
);
CREATE INDEX activity_log_by_kind ON activity_log (kind, on_date);

-- trophy_goal_marks: when each goal was set and first done (progress at or above its target 30 days in a row), saved
-- by every trophy check and right before a goal is deleted. No foreign key on purpose: a goal that was done still counts
-- after it is deleted. A goal is identified by its id AND its exact creation time, because SQLite may give a deleted
-- goal's id to the next new goal.
CREATE TABLE trophy_goal_marks (
  id         INTEGER PRIMARY KEY,
  goal_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  set_on     TEXT    NOT NULL CHECK (set_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_on    TEXT    CHECK (done_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  UNIQUE (goal_id, created_at)
);
