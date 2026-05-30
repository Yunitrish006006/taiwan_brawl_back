DROP INDEX IF EXISTS idx_push_registrations_user;

DROP TABLE IF EXISTS push_registrations_legacy_0028;
ALTER TABLE push_registrations RENAME TO push_registrations_legacy_0028;

CREATE TABLE IF NOT EXISTS push_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'macos', 'web')),
  provider TEXT NOT NULL CHECK (provider = 'fcm'),
  push_token TEXT NOT NULL UNIQUE,
  device_name TEXT,
  locale TEXT,
  app_version TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error_code TEXT,
  last_error_at TEXT,
  invalidated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (installation_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_push_registrations_user
  ON push_registrations (user_id, invalidated_at, updated_at DESC);
