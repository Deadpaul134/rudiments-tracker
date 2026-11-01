-- Per-account practice data. Additive only: no DROP, no UPDATE, no rewrite of `records`.
-- Legacy rows stay in `records` and keep serving the sync-code path until a claim.

-- Google account. `sub` is the stable id; email is stored for reference.
CREATE TABLE IF NOT EXISTS users (
  sub         TEXT    PRIMARY KEY,
  email       TEXT,
  name        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Same shape as `records`, scoped by the Google sub. A friend's rows never share a key with Paul's.
CREATE TABLE IF NOT EXISTS user_records (
  user_sub   TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  data       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (user_sub, kind, id)
);
CREATE INDEX IF NOT EXISTS user_records_seq ON user_records (user_sub, seq);

-- At most one claim of the legacy sync-code dataset. The row is inserted by /api/claim, not by this file.
CREATE TABLE IF NOT EXISTS legacy_claim (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  user_sub   TEXT    NOT NULL,
  claimed_at INTEGER NOT NULL
);
