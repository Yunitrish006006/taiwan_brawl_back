CREATE TABLE IF NOT EXISTS user_deck_characters (
  deck_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  character_id TEXT NOT NULL DEFAULT 'ordinary_child',
  age INTEGER NOT NULL DEFAULT 0,
  health INTEGER NOT NULL DEFAULT 100,
  rebirth_count INTEGER NOT NULL DEFAULT 0,
  talent_history_json TEXT NOT NULL DEFAULT '{}',
  achievements_json TEXT NOT NULL DEFAULT '{}',
  last_health_regen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_rebirth_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (deck_id),
  FOREIGN KEY (deck_id) REFERENCES user_decks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (age >= 0),
  CHECK (health >= 0 AND health <= 100),
  CHECK (rebirth_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_user_deck_characters_user
  ON user_deck_characters (user_id, updated_at);

CREATE TABLE IF NOT EXISTS user_deck_character_events (
  id TEXT PRIMARY KEY,
  deck_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  room_code TEXT,
  result TEXT NOT NULL,
  age_delta INTEGER NOT NULL DEFAULT 0,
  health_delta INTEGER NOT NULL DEFAULT 0,
  age_after INTEGER NOT NULL DEFAULT 0,
  health_after INTEGER NOT NULL DEFAULT 100,
  rebirth_triggered INTEGER NOT NULL DEFAULT 0,
  card_uses_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES user_decks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_deck_character_events_deck
  ON user_deck_character_events (deck_id, created_at);
