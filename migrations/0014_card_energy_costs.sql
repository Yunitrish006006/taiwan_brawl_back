ALTER TABLE cards ADD COLUMN energy_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN energy_cost_type TEXT NOT NULL DEFAULT 'physical';

UPDATE cards
SET energy_cost = elixir_cost
WHERE energy_cost = 0;

UPDATE cards
SET energy_cost_type = CASE
  WHEN type = 'spell' THEN 'spirit'
  ELSE 'physical'
END;
