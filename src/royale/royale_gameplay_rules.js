import {
  GLOBAL_ATTACK_SPEED_MULTIPLIER,
  GLOBAL_MOVE_SPEED_MULTIPLIER,
  MATCH_DURATION_MS,
  TOWER_HP,
} from './royale_battle_rules.js';

export const MINI_ROYALE_GAMEPLAY_RULES_SCHEMA_VERSION = 1;

export const DEFAULT_MINI_ROYALE_GAMEPLAY_RULES = Object.freeze({
  schemaVersion: MINI_ROYALE_GAMEPLAY_RULES_SCHEMA_VERSION,
  rulesetId: 'mini-royale-ranked',
  rulesetVersion: 1,
  matchDurationMs: MATCH_DURATION_MS,
  towerHitPoints: TOWER_HP,
  attackSpeedMultiplier: GLOBAL_ATTACK_SPEED_MULTIPLIER,
  moveSpeedMultiplier: GLOBAL_MOVE_SPEED_MULTIPLIER,
});

const RULE_FIELDS = Object.keys(DEFAULT_MINI_ROYALE_GAMEPLAY_RULES).sort();

export function normalizeMiniRoyaleGameplayRules(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const fields = Object.keys(candidate).sort();
  if (fields.length !== RULE_FIELDS.length ||
      fields.some((field, index) => field !== RULE_FIELDS[index]) ||
      candidate.schemaVersion !== MINI_ROYALE_GAMEPLAY_RULES_SCHEMA_VERSION ||
      typeof candidate.rulesetId !== 'string' ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(candidate.rulesetId) ||
      !Number.isSafeInteger(candidate.rulesetVersion) || candidate.rulesetVersion < 1 ||
      !Number.isSafeInteger(candidate.matchDurationMs) ||
      candidate.matchDurationMs < 60000 || candidate.matchDurationMs > 600000 ||
      !Number.isSafeInteger(candidate.towerHitPoints) ||
      candidate.towerHitPoints < 100 || candidate.towerHitPoints > 100000 ||
      !Number.isFinite(candidate.attackSpeedMultiplier) ||
      candidate.attackSpeedMultiplier < 0.1 || candidate.attackSpeedMultiplier > 5 ||
      !Number.isFinite(candidate.moveSpeedMultiplier) ||
      candidate.moveSpeedMultiplier < 0.1 || candidate.moveSpeedMultiplier > 5) {
    return null;
  }
  return Object.freeze({ ...candidate });
}
