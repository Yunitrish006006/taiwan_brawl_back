ALTER TABLE cards ADD COLUMN body_radius REAL NOT NULL DEFAULT 0.018;

UPDATE cards
SET body_radius = CASE
  WHEN type = 'tank' THEN 0.024
  WHEN type = 'melee' THEN 0.018
  WHEN type = 'swarm' THEN 0.014
  WHEN type = 'ranged' THEN 0.016
  WHEN type IN ('spell', 'equipment') THEN 0
  ELSE 0.018
END;

UPDATE cards
SET attack_range = CASE
  WHEN id = 'swordsman' THEN 0.05
  WHEN id = 'guardian' THEN 0.05
  WHEN id = 'knight' THEN 0.07
  WHEN id = 'giant' THEN 0.07
  WHEN id = 'wolf_pack' THEN 0.035
  WHEN id = 'goblin_team' THEN 0.035
  ELSE attack_range
END
WHERE id IN (
  'swordsman',
  'guardian',
  'knight',
  'giant',
  'wolf_pack',
  'goblin_team'
);
