CREATE TABLE IF NOT EXISTS chat_devices (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_devices_active
  ON chat_devices (user_id, is_active, device_id);

CREATE TABLE IF NOT EXISTS chat_pending_message_acks (
  pending_id INTEGER NOT NULL REFERENCES pending_messages(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (pending_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_pending_acks_receiver
  ON chat_pending_message_acks (receiver_id, device_id, pending_id);
