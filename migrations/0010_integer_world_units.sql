UPDATE cards
SET attack_range = ROUND(CASE
  WHEN attack_range < 10 THEN attack_range * 1000
  ELSE attack_range
END);

UPDATE cards
SET body_radius = ROUND(CASE
  WHEN body_radius < 10 THEN body_radius * 1000
  ELSE body_radius
END);

UPDATE cards
SET move_speed = ROUND(CASE
  WHEN move_speed < 10 THEN move_speed * 1000
  ELSE move_speed
END);

UPDATE cards
SET spell_radius = ROUND(CASE
  WHEN spell_radius < 10 THEN spell_radius * 1000
  ELSE spell_radius
END);
