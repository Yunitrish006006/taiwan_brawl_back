-- Frozen from migrations 0001–0030. User IDs are cross-database logical references.
CREATE TABLE "mini_royale_cards" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  elixir_cost INTEGER NOT NULL,
  type TEXT NOT NULL,
  hp INTEGER NOT NULL DEFAULT 0,
  damage INTEGER NOT NULL DEFAULT 0,
  attack_range REAL NOT NULL DEFAULT 0,
  move_speed REAL NOT NULL DEFAULT 0,
  attack_speed REAL NOT NULL DEFAULT 1,
  spawn_count INTEGER NOT NULL DEFAULT 1,
  spell_radius REAL NOT NULL DEFAULT 0,
  spell_damage INTEGER NOT NULL DEFAULT 0,
  target_rule TEXT NOT NULL DEFAULT 'ground',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, effect_kind TEXT NOT NULL DEFAULT 'none', effect_value REAL NOT NULL DEFAULT 0, body_radius REAL NOT NULL DEFAULT 0.018, name_zh_hant TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', name_ja TEXT NOT NULL DEFAULT '', name_i18n TEXT NOT NULL DEFAULT '{}', image_version INTEGER NOT NULL DEFAULT 0, energy_cost INTEGER NOT NULL DEFAULT 0, energy_cost_type TEXT NOT NULL DEFAULT 'physical', char_image_version INTEGER NOT NULL DEFAULT 0, bg_image_version INTEGER NOT NULL DEFAULT 0, char_image_back_version INTEGER NOT NULL DEFAULT 0, char_image_left_version INTEGER NOT NULL DEFAULT 0, char_image_right_version INTEGER NOT NULL DEFAULT 0, collision_behavior TEXT NOT NULL DEFAULT 'hold');

CREATE TABLE "mini_royale_user_decks" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slot INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, slot)
);

CREATE TABLE "mini_royale_user_deck_cards" (
  deck_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  PRIMARY KEY (deck_id, position),
  FOREIGN KEY (deck_id) REFERENCES "mini_royale_user_decks"(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES "mini_royale_cards"(id)
);

CREATE TABLE "mini_royale_match_history" (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_one_user_id INTEGER NOT NULL,
  player_two_user_id INTEGER NOT NULL,
  winner_user_id INTEGER,
  reason TEXT NOT NULL,
  player_one_tower_hp INTEGER NOT NULL,
  player_two_tower_hp INTEGER NOT NULL,
  summary_json TEXT,
  ended_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "mini_royale_card_character_assets" (
  card_id TEXT NOT NULL,
  asset_id TEXT NOT NULL CHECK (length(asset_id) BETWEEN 1 AND 64),
  animation TEXT NOT NULL DEFAULT 'idle' CHECK (length(animation) BETWEEN 1 AND 32),
  direction TEXT NOT NULL DEFAULT 'front' CHECK (direction IN ('front', 'back', 'left', 'right')),
  frame_index INTEGER NOT NULL DEFAULT 0 CHECK (frame_index BETWEEN 0 AND 999),
  duration_ms INTEGER NOT NULL DEFAULT 120 CHECK (duration_ms BETWEEN 33 AND 5000),
  loop INTEGER NOT NULL DEFAULT 1 CHECK (loop IN (0, 1)),
  image_version INTEGER NOT NULL DEFAULT 0 CHECK (image_version >= 0),
  file_name TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, asset_version TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (card_id, asset_id),
  FOREIGN KEY (card_id) REFERENCES "mini_royale_cards"(id) ON DELETE CASCADE
);

CREATE TABLE "mini_royale_user_deck_characters" (
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
  FOREIGN KEY (deck_id) REFERENCES "mini_royale_user_decks"(id) ON DELETE CASCADE,
  CHECK (age >= 0),
  CHECK (health >= 0 AND health <= 100),
  CHECK (rebirth_count >= 0)
);

CREATE TABLE "mini_royale_user_deck_character_events" (
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
  FOREIGN KEY (deck_id) REFERENCES "mini_royale_user_decks"(id) ON DELETE CASCADE
);

CREATE INDEX idx_mini_royale_card_character_assets_card_animation
  ON mini_royale_card_character_assets (
    card_id, animation, direction, frame_index
  );

CREATE INDEX idx_mini_royale_user_deck_characters_user
  ON mini_royale_user_deck_characters (user_id, updated_at);

CREATE INDEX idx_mini_royale_user_deck_character_events_deck
  ON mini_royale_user_deck_character_events (deck_id, created_at);
