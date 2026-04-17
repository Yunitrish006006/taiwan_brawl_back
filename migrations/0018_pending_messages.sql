-- Offline relay: pending messages delivered when receiver comes online
CREATE TABLE IF NOT EXISTS pending_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pending_receiver ON pending_messages (receiver_id, created_at);
