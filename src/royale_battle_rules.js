export const TICK_MS = 66;
export const MATCH_DURATION_MS = 210000;
export const WORLD_SCALE = 1000;
export const CENTER_LATERAL = WORLD_SCALE / 2;
export const MAX_ELIXIR = 10;
export const ELIXIR_PER_SECOND = 0.8;
export const LEFT_TOWER_X = 50;
export const RIGHT_TOWER_X = 950;
export const LEFT_DEPLOY_MAX = 420;
export const RIGHT_DEPLOY_MIN = 580;
export const MIN_FIELD_PROGRESS = 0;
export const MAX_FIELD_PROGRESS = 1000;
export const TOWER_HP = 3000;
export const DISCONNECT_GRACE_MS = 15000;
export const PERSIST_INTERVAL_MS = 1000;
export const MAX_COMBO_CARDS = 3;
export const LATERAL_MIN = 0;
export const LATERAL_MAX = 1000;
export const BOT_MIN_THINK_MS = 950;
export const BOT_MAX_THINK_MS = 1800;
export const GLOBAL_MOVE_SPEED_MULTIPLIER = 0.58;
export const GLOBAL_ATTACK_SPEED_MULTIPLIER = 1.18;
export const FIELD_ASPECT_RATIO = 0.62;
export const TOWER_BODY_RADIUS = 30;
export const UNIT_COLLISION_GAP = 6;

// Status effect constants
export const BRUISE_DAMAGE_PER_SECOND = 20;
export const BLEED_DAMAGE_PER_SECOND = 50;
export const BRUISE_DURATION_MS = 3000;
export const BLEED_DURATION_MS = 4000;
export const MENTAL_ILLNESS_DURATION_MS = 5000;
export const MENTAL_ILLNESS_ATTACK_PENALTY = 0.40;
export const STUN_DURATION_MS = 900;
export const SLOW_DURATION_MS = 2000;
export const SLOW_SPEED_FACTOR = 0.70;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function toWorldInteger(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value) <= 1 ? Math.round(value * WORLD_SCALE) : Math.round(value);
}

export function toNormalizedWorld(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value) <= 1 ? value : value / WORLD_SCALE;
}

export function sideDirection(side) {
  return side === 'left' ? 1 : -1;
}

export function deployRangeForSide(side) {
  return side === 'left' ? [MIN_FIELD_PROGRESS, LEFT_DEPLOY_MAX] : [RIGHT_DEPLOY_MIN, MAX_FIELD_PROGRESS];
}

export function sanitizeLanePosition(side, value) {
  const [min, max] = deployRangeForSide(side);
  if (!Number.isFinite(value)) {
    return (min + max) / 2;
  }
  return clamp(value, min, max);
}

export function sanitizeLateralPosition(value) {
  if (!Number.isFinite(value)) {
    return CENTER_LATERAL;
  }
  return clamp(value, LATERAL_MIN, LATERAL_MAX);
}

export function toWorldProgress(side, viewY) {
  const normalizedY = clamp(toNormalizedWorld(viewY), 0, 1);
  const worldY = Math.round(normalizedY * WORLD_SCALE);
  return side === 'left' ? WORLD_SCALE - worldY : worldY;
}

export function normalizeDropPoint(side, payload) {
  const hasExactPoint =
    Number.isFinite(Number(payload?.dropX)) &&
    Number.isFinite(Number(payload?.dropY));

  if (!hasExactPoint) {
    return {
      progress: sanitizeLanePosition(side, toWorldInteger(Number(payload?.lanePosition))),
      lateralPosition: CENTER_LATERAL
    };
  }

  return {
    progress: sanitizeLanePosition(side, toWorldProgress(side, Number(payload.dropY))),
    lateralPosition: sanitizeLateralPosition(toWorldInteger(Number(payload.dropX)))
  };
}

export function distanceBetweenPoints(aProgress, aLateral, bProgress, bLateral) {
  return Math.hypot(
    aProgress - bProgress,
    (aLateral - bLateral) * FIELD_ASPECT_RATIO
  );
}

export function bodyRadiusForUnitType(type) {
  switch (type) {
    case 'tank':
      return 24;
    case 'melee':
      return 18;
    case 'swarm':
      return 14;
    case 'ranged':
      return 16;
    default:
      return 18;
  }
}

export function displayAttackReach(unit) {
  return Number(unit.attackRange || 0) + Number(unit.bodyRadius || bodyRadiusForUnitType(unit.type));
}

export function effectiveSpellReachToUnit(spellRadius, target) {
  return Number(spellRadius || 0) + Number(target?.bodyRadius || bodyRadiusForUnitType(target?.type));
}

export function effectiveSpellReachToTower(spellRadius) {
  return Number(spellRadius || 0) + TOWER_BODY_RADIUS;
}

export function minimumBodyContactDistance(bodyRadius, otherBodyRadius, gap = 0) {
  return Number(bodyRadius || 0) + Number(otherBodyRadius || 0) + Number(gap || 0);
}

export function lateralOffsetForWorldDistance(worldDistance) {
  return Number(worldDistance || 0) / FIELD_ASPECT_RATIO;
}

export function effectiveAttackReachToUnit(unit, target) {
  return displayAttackReach(unit) + Number(target.bodyRadius || bodyRadiusForUnitType(target.type));
}

export function effectiveAttackReachToTower(unit) {
  return displayAttackReach(unit) + TOWER_BODY_RADIUS;
}

export function normalizeSimulationMode(value) {
  return String(value ?? 'server').trim().toLowerCase() === 'host'
    ? 'host'
    : 'server';
}

export function randomBotThinkMs(random = Math.random) {
  return Math.floor(BOT_MIN_THINK_MS + random() * (BOT_MAX_THINK_MS - BOT_MIN_THINK_MS));
}
