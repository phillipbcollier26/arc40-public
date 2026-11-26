-- 006: remember transfer pairs the user broke apart, so automatic linking after
-- the next import never pairs them again. A pair is stored once, smaller id first.
-- Deleting either transaction removes the block (so a reused id starts clean).

CREATE TABLE transfer_link_blocks (
  low_id     INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  high_id    INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id)
);
CREATE INDEX transfer_link_blocks_by_high ON transfer_link_blocks (high_id);
