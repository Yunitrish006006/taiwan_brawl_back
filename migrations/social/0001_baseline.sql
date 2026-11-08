-- Frozen from migrations 0001–0030. User IDs are cross-database logical references.
CREATE TABLE friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL,
  receiver_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE friendships (
  user_one_id INTEGER NOT NULL,
  user_two_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_one_id, user_two_id)
);

CREATE TABLE user_blocks (
  blocker_user_id INTEGER NOT NULL,
  blocked_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

CREATE TABLE room_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  inviter_user_id INTEGER NOT NULL,
  invitee_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, game_id TEXT NOT NULL DEFAULT 'game.mini-royale'
);

CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pending_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
, type TEXT NOT NULL DEFAULT 'message', event_id TEXT, message_id TEXT, revision INTEGER, event_type TEXT, signature TEXT, device_id TEXT);

CREATE TABLE chat_devices (
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE chat_pending_message_acks (
  pending_id INTEGER NOT NULL REFERENCES pending_messages(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (pending_id, device_id)
);

CREATE INDEX idx_friend_requests_receiver_status
ON friend_requests(receiver_user_id, status, created_at DESC);

CREATE INDEX idx_friend_requests_sender_status
ON friend_requests(sender_user_id, status, created_at DESC);

CREATE INDEX idx_room_invites_invitee_status
ON room_invites(invitee_user_id, status, created_at DESC);

CREATE INDEX idx_room_invites_inviter_status
ON room_invites(inviter_user_id, status, created_at DESC);

CREATE INDEX idx_chat_dm ON chat_messages (
  sender_id,
  receiver_id,
  created_at
);

CREATE UNIQUE INDEX idx_pending_event_id
  ON pending_messages (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX idx_pending_receiver ON pending_messages (receiver_id, created_at);

CREATE INDEX idx_pending_receiver_sender_id
  ON pending_messages (receiver_id, sender_id, id);

CREATE INDEX idx_chat_devices_active
  ON chat_devices (user_id, is_active, device_id);

CREATE INDEX idx_chat_pending_acks_receiver
  ON chat_pending_message_acks (receiver_id, device_id, pending_id);
