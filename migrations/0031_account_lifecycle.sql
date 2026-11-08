ALTER TABLE users ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active','deleting','disabled'));
ALTER TABLE users ADD COLUMN lifecycle_epoch INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_epoch > 0);
CREATE TABLE lifecycle_outbox (
  event_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('deleting','disabled')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE lifecycle_outbox_deliveries (
  event_id TEXT NOT NULL REFERENCES lifecycle_outbox(event_id),
  target TEXT NOT NULL CHECK (target IN ('social','games')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  completed_at TEXT,
  PRIMARY KEY(event_id,target)
);
CREATE INDEX idx_lifecycle_due ON lifecycle_outbox_deliveries(completed_at,next_attempt_at);
