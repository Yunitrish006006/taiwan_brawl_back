CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chat_dm ON chat_messages (
  sender_id,
  receiver_id,
  created_at
);
