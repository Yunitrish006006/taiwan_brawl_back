CREATE TABLE IF NOT EXISTS cards (
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
);

CREATE TABLE IF NOT EXISTS user_decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slot INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, slot),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_deck_cards (
  deck_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  PRIMARY KEY (deck_id, position),
  FOREIGN KEY (deck_id) REFERENCES user_decks(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS match_history (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_one_user_id INTEGER NOT NULL,
  player_two_user_id INTEGER NOT NULL,
  winner_user_id INTEGER,
  reason TEXT NOT NULL,
  player_one_tower_hp INTEGER NOT NULL,
  player_two_tower_hp INTEGER NOT NULL,
  summary_json TEXT,
  ended_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_one_user_id) REFERENCES users(id),
  FOREIGN KEY (player_two_user_id) REFERENCES users(id),
  FOREIGN KEY (winner_user_id) REFERENCES users(id)
);

INSERT OR IGNORE INTO cards (
  id, name, elixir_cost, type, hp, damage, attack_range, move_speed,
  attack_speed, spawn_count, spell_radius, spell_damage, target_rule
) VALUES
  ('swordsman', '劍士', 3, 'melee', 420, 120, 0.08, 0.16, 0.9, 1, 0, 0, 'ground'),
  ('guardian', '護衛', 2, 'melee', 320, 85, 0.08, 0.18, 0.75, 1, 0, 0, 'ground'),
  ('knight', '騎士', 4, 'tank', 980, 150, 0.1, 0.14, 1.0, 1, 0, 0, 'ground'),
  ('giant', '巨人', 5, 'tank', 1680, 190, 0.1, 0.11, 1.2, 1, 0, 0, 'tower'),
  ('archer', '弓手', 3, 'ranged', 260, 110, 0.28, 0.14, 1.0, 1, 0, 0, 'ground'),
  ('musketeer', '火槍手', 4, 'ranged', 380, 180, 0.3, 0.13, 1.1, 1, 0, 0, 'ground'),
  ('bomber', '投彈兵', 3, 'ranged', 240, 130, 0.24, 0.14, 1.0, 1, 0, 0, 'ground'),
  ('wolf_pack', '狼群', 3, 'swarm', 120, 55, 0.06, 0.2, 0.6, 3, 0, 0, 'ground'),
  ('goblin_team', '哥布林小隊', 2, 'swarm', 95, 48, 0.06, 0.22, 0.55, 4, 0, 0, 'ground'),
  ('fireball', '火球', 4, 'spell', 0, 0, 0, 0, 0, 1, 0.13, 280, 'area'),
  ('zap', '電擊', 2, 'spell', 0, 0, 0, 0, 0, 1, 0.1, 140, 'area'),
  ('healer', '祭司', 3, 'ranged', 300, 95, 0.22, 0.12, 1.1, 1, 0, 0, 'ground');
