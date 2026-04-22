CREATE TABLE IF NOT EXISTS card_character_assets (
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (card_id, asset_id),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_character_assets_card_animation
  ON card_character_assets (card_id, animation, direction, frame_index);
