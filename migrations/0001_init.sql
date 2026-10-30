-- Rudiments Tracker sync store (Cloudflare D1, binding "DB").
-- kind: e = entry, s = session, d = practice day, x = custom exercise, c = custom sub-exercise, p = plan document
CREATE TABLE IF NOT EXISTS records (
  kind       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  data       TEXT,                       -- JSON, NULL when deleted
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 = tombstone (explicit delete)
  updated_at INTEGER NOT NULL,           -- ms since epoch, last change wins
  seq        INTEGER NOT NULL,           -- server change counter (client cursor)
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
