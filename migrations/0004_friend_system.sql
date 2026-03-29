ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN last_active_at TEXT;

UPDATE users
SET last_active_at = COALESCE(last_active_at, created_at);

CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL,
  receiver_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_user_id) REFERENCES users(id),
  FOREIGN KEY (receiver_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status
ON friend_requests(receiver_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_status
ON friend_requests(sender_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  user_one_id INTEGER NOT NULL,
  user_two_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_one_id, user_two_id),
  FOREIGN KEY (user_one_id) REFERENCES users(id),
  FOREIGN KEY (user_two_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id INTEGER NOT NULL,
  blocked_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  FOREIGN KEY (blocker_user_id) REFERENCES users(id),
  FOREIGN KEY (blocked_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS room_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  inviter_user_id INTEGER NOT NULL,
  invitee_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inviter_user_id) REFERENCES users(id),
  FOREIGN KEY (invitee_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_room_invites_invitee_status
ON room_invites(invitee_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_invites_inviter_status
ON room_invites(inviter_user_id, status, created_at DESC);
