ALTER TABLE cards
ADD COLUMN collision_behavior TEXT NOT NULL DEFAULT 'hold';

UPDATE cards
SET collision_behavior = CASE
  WHEN type = 'swarm' THEN 'reroute'
  ELSE 'hold'
END;
