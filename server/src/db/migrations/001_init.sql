-- 001: auth + settings.
-- Money is NEVER stored as REAL. Every money column in later migrations is
-- INTEGER cents (column names end in _cents).

CREATE TABLE app_user (
  id            INTEGER PRIMARY KEY CHECK (id = 1), -- single-user app
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash   TEXT    PRIMARY KEY, -- sha256 of the cookie value; raw token never stored
  csrf_token   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON-encoded
);
