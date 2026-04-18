CREATE TABLE IF NOT EXISTS push_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'web')),
  provider TEXT NOT NULL CHECK (provider IN ('apns', 'webpush')),
  push_token TEXT UNIQUE,
  endpoint TEXT UNIQUE,
  subscription_json TEXT,
  p256dh_key TEXT,
  auth_key TEXT,
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
  UNIQUE (installation_id, platform),
  CHECK (
    (provider = 'apns' AND push_token IS NOT NULL AND endpoint IS NULL AND subscription_json IS NULL AND p256dh_key IS NULL AND auth_key IS NULL) OR
    (provider = 'webpush' AND push_token IS NULL AND endpoint IS NOT NULL AND subscription_json IS NOT NULL AND p256dh_key IS NOT NULL AND auth_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_push_registrations_user
  ON push_registrations (user_id, invalidated_at, updated_at DESC);
