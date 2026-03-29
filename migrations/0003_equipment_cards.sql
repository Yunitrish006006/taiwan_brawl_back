ALTER TABLE cards ADD COLUMN effect_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE cards ADD COLUMN effect_value REAL NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO cards (
  id, name, elixir_cost, type, hp, damage, attack_range, move_speed,
  attack_speed, spawn_count, spell_radius, spell_damage, target_rule,
  effect_kind, effect_value
) VALUES
  ('iron_blade', '鋼刃', 2, 'equipment', 0, 0, 0, 0, 0, 1, 0, 0, 'ally_combo', 'damage_boost', 45),
  ('swift_boots', '疾行靴', 2, 'equipment', 0, 0, 0, 0, 0, 1, 0, 0, 'ally_combo', 'speed_boost', 0.35),
  ('guardian_armor', '守衛甲', 3, 'equipment', 0, 0, 0, 0, 0, 1, 0, 0, 'ally_combo', 'health_boost', 180);
