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
export const DISCARD_SPIRIT_COST = 1;
export const LATERAL_MIN = 0;
export const LATERAL_MAX = 1000;
export const BOT_MIN_THINK_MS = 950;
export const BOT_MAX_THINK_MS = 1800;
export const GLOBAL_MOVE_SPEED_MULTIPLIER = 0.58;
export const GLOBAL_ATTACK_SPEED_MULTIPLIER = 1.18;
export const FIELD_ASPECT_RATIO = 0.62;
export const TOWER_BODY_RADIUS = 30;
export const UNIT_COLLISION_GAP = 6;
export const UNIT_FORMATION_BIAS_LIMIT = 90;
export const RIVER_MIN_PROGRESS = LEFT_DEPLOY_MAX + 35;
export const RIVER_MAX_PROGRESS = RIGHT_DEPLOY_MIN - 35;
export const BRIDGE_MIN_PROGRESS = 430;
export const BRIDGE_MAX_PROGRESS = 570;
export const BRIDGE_MIN_LATERAL = 380;
export const BRIDGE_MAX_LATERAL = 620;
export const DOUBLE_BRIDGE_LEFT_MIN_LATERAL = 220;
export const DOUBLE_BRIDGE_LEFT_MAX_LATERAL = 390;
export const DOUBLE_BRIDGE_RIGHT_MIN_LATERAL = 610;
export const DOUBLE_BRIDGE_RIGHT_MAX_LATERAL = 780;

export const DEFAULT_ARENA_ID = 'classic_bridge';
export const DOUBLE_BRIDGE_ARENA_ID = 'classic_double_bridge';
export const WIDE_BRIDGE_ARENA_ID = 'classic_wide_bridge';
export const SIDE_BRIDGES_ARENA_ID = 'classic_side_bridges';
export const TRIPLE_BRIDGE_ARENA_ID = 'classic_three_bridges';
export const DEFAULT_ARENA_CONFIG = {
  id: DEFAULT_ARENA_ID,
  name: 'Classic Bridge',
  width: WORLD_SCALE,
  height: WORLD_SCALE,
  progressMin: MIN_FIELD_PROGRESS,
  progressMax: MAX_FIELD_PROGRESS,
  lateralMin: LATERAL_MIN,
  lateralMax: LATERAL_MAX,
  centerLateral: CENTER_LATERAL,
  fieldAspectRatio: FIELD_ASPECT_RATIO,
  towers: {
    left: {
      progress: LEFT_TOWER_X,
      lateralPosition: CENTER_LATERAL
    },
    right: {
      progress: RIGHT_TOWER_X,
      lateralPosition: CENTER_LATERAL
    }
  },
  deploy: {
    left: {
      min: MIN_FIELD_PROGRESS,
      max: LEFT_DEPLOY_MAX
    },
    right: {
      min: RIGHT_DEPLOY_MIN,
      max: MAX_FIELD_PROGRESS
    }
  },
  terrainGates: [
    {
      id: 'central_river',
      kind: 'river',
      progressMin: RIVER_MIN_PROGRESS,
      progressMax: RIVER_MAX_PROGRESS,
      bridgeMinProgress: BRIDGE_MIN_PROGRESS,
      bridgeMaxProgress: BRIDGE_MAX_PROGRESS,
      passableLateralRanges: [
        {
          min: BRIDGE_MIN_LATERAL,
          max: BRIDGE_MAX_LATERAL
        }
      ]
    }
  ],
  obstacles: []
};

function bridgeArenaConfig(id, name, gateId, passableLateralRanges) {
  return {
    ...DEFAULT_ARENA_CONFIG,
    id,
    name,
    terrainGates: [
      {
        id: gateId,
        kind: 'river',
        progressMin: RIVER_MIN_PROGRESS,
        progressMax: RIVER_MAX_PROGRESS,
        bridgeMinProgress: BRIDGE_MIN_PROGRESS,
        bridgeMaxProgress: BRIDGE_MAX_PROGRESS,
        passableLateralRanges
      }
    ],
    obstacles: []
  };
}

export const DOUBLE_BRIDGE_ARENA_CONFIG = bridgeArenaConfig(
  DOUBLE_BRIDGE_ARENA_ID,
  'Classic Double Bridge',
  'central_river_double_bridge',
  [
    {
      min: DOUBLE_BRIDGE_LEFT_MIN_LATERAL,
      max: DOUBLE_BRIDGE_LEFT_MAX_LATERAL
    },
    {
      min: DOUBLE_BRIDGE_RIGHT_MIN_LATERAL,
      max: DOUBLE_BRIDGE_RIGHT_MAX_LATERAL
    }
  ]
);

export const WIDE_BRIDGE_ARENA_CONFIG = bridgeArenaConfig(
  WIDE_BRIDGE_ARENA_ID,
  'Wide Center Bridge',
  'central_river_wide_bridge',
  [
    {
      min: 300,
      max: 700
    }
  ]
);

export const SIDE_BRIDGES_ARENA_CONFIG = bridgeArenaConfig(
  SIDE_BRIDGES_ARENA_ID,
  'Side Bridges',
  'central_river_side_bridges',
  [
    {
      min: 140,
      max: 320
    },
    {
      min: 680,
      max: 860
    }
  ]
);

export const TRIPLE_BRIDGE_ARENA_CONFIG = bridgeArenaConfig(
  TRIPLE_BRIDGE_ARENA_ID,
  'Three Bridge Crossing',
  'central_river_three_bridges',
  [
    {
      min: 150,
      max: 270
    },
    {
      min: 440,
      max: 560
    },
    {
      min: 730,
      max: 850
    }
  ]
);

export const ARENA_CATALOG = [
  DEFAULT_ARENA_CONFIG,
  DOUBLE_BRIDGE_ARENA_CONFIG,
  WIDE_BRIDGE_ARENA_CONFIG,
  SIDE_BRIDGES_ARENA_CONFIG,
  TRIPLE_BRIDGE_ARENA_CONFIG
];

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

function finiteNumber(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeMinMax(minValue, maxValue, fallbackMin, fallbackMax) {
  const min = finiteNumber(minValue, fallbackMin);
  const max = finiteNumber(maxValue, fallbackMax);
  if (max > min) {
    return [min, max];
  }
  return [fallbackMin, fallbackMax];
}

function normalizeLateralRanges(ranges, arena) {
  const rawRanges = Array.isArray(ranges) ? ranges : [];
  return rawRanges
    .map((range) => {
      const [min, max] = normalizeMinMax(
        range?.min ?? range?.lateralMin,
        range?.max ?? range?.lateralMax,
        arena.lateralMin,
        arena.lateralMax
      );
      return {
        min: clamp(min, arena.lateralMin, arena.lateralMax),
        max: clamp(max, arena.lateralMin, arena.lateralMax)
      };
    })
    .filter((range) => range.max > range.min);
}

function normalizeTerrainGates(source, arena) {
  return source
    .map((gate, index) => {
      const [progressMin, progressMax] = normalizeMinMax(
        gate?.progressMin,
        gate?.progressMax,
        arena.progressMin,
        arena.progressMin
      );
      const ranges = normalizeLateralRanges(
        gate?.passableLateralRanges,
        arena
      );
      if (progressMax <= progressMin || ranges.length === 0) {
        return null;
      }
      return {
        id: String(gate?.id || `terrain_gate_${index + 1}`),
        kind: String(gate?.kind || 'gate'),
        progressMin,
        progressMax,
        bridgeMinProgress: finiteNumber(gate?.bridgeMinProgress, progressMin),
        bridgeMaxProgress: finiteNumber(gate?.bridgeMaxProgress, progressMax),
        passableLateralRanges: ranges
      };
    })
    .filter(Boolean);
}

function normalizeObstacles(source, arena) {
  return source
    .map((obstacle, index) => {
      const [progressMin, progressMax] = normalizeMinMax(
        obstacle?.progressMin,
        obstacle?.progressMax,
        arena.progressMin,
        arena.progressMin
      );
      const [lateralMin, lateralMax] = normalizeMinMax(
        obstacle?.lateralMin,
        obstacle?.lateralMax,
        arena.lateralMin,
        arena.lateralMin
      );
      if (progressMax <= progressMin || lateralMax <= lateralMin) {
        return null;
      }
      return {
        id: String(obstacle?.id || `obstacle_${index + 1}`),
        kind: String(obstacle?.kind || 'rect'),
        progressMin: clamp(progressMin, arena.progressMin, arena.progressMax),
        progressMax: clamp(progressMax, arena.progressMin, arena.progressMax),
        lateralMin: clamp(lateralMin, arena.lateralMin, arena.lateralMax),
        lateralMax: clamp(lateralMax, arena.lateralMin, arena.lateralMax)
      };
    })
    .filter(
      (obstacle) =>
        obstacle &&
        obstacle.progressMax > obstacle.progressMin &&
        obstacle.lateralMax > obstacle.lateralMin
    );
}

export function normalizeArenaConfig(config = DEFAULT_ARENA_CONFIG) {
  const source =
    config && typeof config === 'object' && !Array.isArray(config)
      ? config
      : DEFAULT_ARENA_CONFIG;
  const [progressMin, progressMax] = normalizeMinMax(
    source.progressMin,
    source.progressMax ?? source.height ?? source.worldScale,
    MIN_FIELD_PROGRESS,
    MAX_FIELD_PROGRESS
  );
  const [lateralMin, lateralMax] = normalizeMinMax(
    source.lateralMin,
    source.lateralMax ?? source.width ?? source.worldScale,
    LATERAL_MIN,
    LATERAL_MAX
  );
  const baseArena = {
    id: String(source.id || DEFAULT_ARENA_ID),
    name: String(source.name || source.id || DEFAULT_ARENA_CONFIG.name),
    width: finiteNumber(source.width, lateralMax - lateralMin),
    height: finiteNumber(source.height, progressMax - progressMin),
    progressMin,
    progressMax,
    lateralMin,
    lateralMax,
    centerLateral: clamp(
      finiteNumber(source.centerLateral, (lateralMin + lateralMax) / 2),
      lateralMin,
      lateralMax
    ),
    fieldAspectRatio: Math.max(
      0.05,
      finiteNumber(source.fieldAspectRatio, FIELD_ASPECT_RATIO)
    )
  };
  const towers = source.towers || {};
  const deploy = source.deploy || {};
  const defaultTerrainGates =
    source === DEFAULT_ARENA_CONFIG ? DEFAULT_ARENA_CONFIG.terrainGates : [];

  return {
    ...baseArena,
    towers: {
      left: {
        progress: clamp(
          finiteNumber(towers.left?.progress, LEFT_TOWER_X),
          progressMin,
          progressMax
        ),
        lateralPosition: clamp(
          finiteNumber(towers.left?.lateralPosition, baseArena.centerLateral),
          lateralMin,
          lateralMax
        )
      },
      right: {
        progress: clamp(
          finiteNumber(towers.right?.progress, RIGHT_TOWER_X),
          progressMin,
          progressMax
        ),
        lateralPosition: clamp(
          finiteNumber(towers.right?.lateralPosition, baseArena.centerLateral),
          lateralMin,
          lateralMax
        )
      }
    },
    deploy: {
      left: {
        min: clamp(
          finiteNumber(deploy.left?.min, progressMin),
          progressMin,
          progressMax
        ),
        max: clamp(
          finiteNumber(deploy.left?.max, LEFT_DEPLOY_MAX),
          progressMin,
          progressMax
        )
      },
      right: {
        min: clamp(
          finiteNumber(deploy.right?.min, RIGHT_DEPLOY_MIN),
          progressMin,
          progressMax
        ),
        max: clamp(
          finiteNumber(deploy.right?.max, progressMax),
          progressMin,
          progressMax
        )
      }
    },
    terrainGates: normalizeTerrainGates(
      Array.isArray(source.terrainGates)
        ? source.terrainGates
        : defaultTerrainGates,
      baseArena
    ),
    obstacles: normalizeObstacles(
      Array.isArray(source.obstacles) ? source.obstacles : [],
      baseArena
    )
  };
}

export function arenaConfigForBattle(battle) {
  return normalizeArenaConfig(battle?.arena ?? DEFAULT_ARENA_CONFIG);
}

export function listArenaConfigs() {
  return ARENA_CATALOG.map((arena) => normalizeArenaConfig(arena));
}

export function arenaConfigById(id) {
  const normalizedId = String(id ?? '').trim();
  return normalizeArenaConfig(
    ARENA_CATALOG.find((arena) => arena.id === normalizedId) ??
      DEFAULT_ARENA_CONFIG
  );
}

export function randomArenaConfig(random = Math.random) {
  const randomSource = typeof random === 'function' ? random : Math.random;
  const roll = Number(randomSource());
  const normalizedRoll = Number.isFinite(roll) ? clamp(roll, 0, 0.999999) : 0;
  const index = Math.floor(normalizedRoll * ARENA_CATALOG.length);
  return normalizeArenaConfig(ARENA_CATALOG[index] ?? DEFAULT_ARENA_CONFIG);
}

export function arenaCenterLateral(arena = DEFAULT_ARENA_CONFIG) {
  return normalizeArenaConfig(arena).centerLateral;
}

export function arenaFieldAspectRatio(arena = DEFAULT_ARENA_CONFIG) {
  return normalizeArenaConfig(arena).fieldAspectRatio;
}

export function towerPointForSide(side, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedArena = normalizeArenaConfig(arena);
  const tower =
    side === 'left'
      ? normalizedArena.towers.left
      : normalizedArena.towers.right;
  return {
    progress: tower.progress,
    lateralPosition: tower.lateralPosition
  };
}

export function towerProgressForSide(side, arena = DEFAULT_ARENA_CONFIG) {
  return towerPointForSide(side, arena).progress;
}

export function toWorldInteger(value, scale = WORLD_SCALE) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value) <= 1 ? Math.round(value * scale) : Math.round(value);
}

export function toNormalizedWorld(value, scale = WORLD_SCALE) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value) <= 1 ? value : value / scale;
}

export function sideDirection(side) {
  return side === 'left' ? 1 : -1;
}

export function deployRangeForSide(side, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedArena = normalizeArenaConfig(arena);
  const range =
    side === 'left'
      ? normalizedArena.deploy.left
      : normalizedArena.deploy.right;
  return [range.min, range.max];
}

export function sanitizeLanePosition(side, value, arena = DEFAULT_ARENA_CONFIG) {
  const [min, max] = deployRangeForSide(side, arena);
  if (!Number.isFinite(value)) {
    return (min + max) / 2;
  }
  return clamp(value, min, max);
}

export function sanitizeLateralPosition(value, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedArena = normalizeArenaConfig(arena);
  if (!Number.isFinite(value)) {
    return normalizedArena.centerLateral;
  }
  return clamp(value, normalizedArena.lateralMin, normalizedArena.lateralMax);
}

export function isRiverProgress(progress, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedProgress = Number(progress);
  const normalizedArena = normalizeArenaConfig(arena);
  return normalizedArena.terrainGates.some(
    (gate) =>
      gate.kind === 'river' &&
      Number.isFinite(normalizedProgress) &&
      normalizedProgress > gate.progressMin &&
      normalizedProgress < gate.progressMax
  );
}

function lateralWithinRanges(lateral, ranges) {
  return ranges.some(
    (range) => lateral >= range.min && lateral <= range.max
  );
}

function closestLateralInRanges(lateral, ranges) {
  let closest = lateral;
  let bestDistance = Infinity;
  for (const range of ranges) {
    const candidate = clamp(lateral, range.min, range.max);
    const distance = Math.abs(candidate - lateral);
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = candidate;
    }
  }
  return closest;
}

function intersectLateralRanges(leftRanges, rightRanges) {
  const intersections = [];
  for (const left of leftRanges) {
    for (const right of rightRanges) {
      const min = Math.max(left.min, right.min);
      const max = Math.min(left.max, right.max);
      if (max >= min) {
        intersections.push({ min, max });
      }
    }
  }
  return intersections;
}

export function terrainGateLateralRangesForProgress(
  progress,
  arena = DEFAULT_ARENA_CONFIG
) {
  const normalizedProgress = Number(progress);
  const normalizedArena = normalizeArenaConfig(arena);
  if (!Number.isFinite(normalizedProgress)) {
    return [
      {
        min: normalizedArena.lateralMin,
        max: normalizedArena.lateralMax
      }
    ];
  }

  let ranges = [
    {
      min: normalizedArena.lateralMin,
      max: normalizedArena.lateralMax
    }
  ];
  for (const gate of normalizedArena.terrainGates) {
    if (
      normalizedProgress > gate.progressMin &&
      normalizedProgress < gate.progressMax
    ) {
      ranges = intersectLateralRanges(ranges, gate.passableLateralRanges);
    }
  }
  return ranges;
}

export function terrainGateLateralRangesForPath(
  startProgress,
  endProgress,
  arena = DEFAULT_ARENA_CONFIG
) {
  const start = Number(startProgress);
  const end = Number(endProgress);
  const normalizedArena = normalizeArenaConfig(arena);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return [
      {
        min: normalizedArena.lateralMin,
        max: normalizedArena.lateralMax
      }
    ];
  }

  const minProgress = Math.min(start, end);
  const maxProgress = Math.max(start, end);
  let ranges = [
    {
      min: normalizedArena.lateralMin,
      max: normalizedArena.lateralMax
    }
  ];
  for (const gate of normalizedArena.terrainGates) {
    if (minProgress < gate.progressMax && maxProgress > gate.progressMin) {
      ranges = intersectLateralRanges(ranges, gate.passableLateralRanges);
    }
  }
  return ranges;
}

export function isBridgeLateral(lateral, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedLateral = sanitizeLateralPosition(lateral, arena);
  const normalizedArena = normalizeArenaConfig(arena);
  const ranges = normalizedArena.terrainGates.flatMap(
    (gate) => gate.passableLateralRanges
  );
  if (ranges.length === 0) {
    return true;
  }
  return lateralWithinRanges(normalizedLateral, ranges);
}

export function pathIntersectsRiver(
  startProgress,
  endProgress,
  arena = DEFAULT_ARENA_CONFIG
) {
  const start = Number(startProgress);
  const end = Number(endProgress);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }

  const minProgress = Math.min(start, end);
  const maxProgress = Math.max(start, end);
  return normalizeArenaConfig(arena).terrainGates.some(
    (gate) =>
      minProgress < gate.progressMax &&
      maxProgress > gate.progressMin
  );
}

export function terrainNavigationLateralForMove(
  startProgress,
  targetProgress,
  desiredLateral,
  arena = DEFAULT_ARENA_CONFIG
) {
  const sanitizedLateral = sanitizeLateralPosition(desiredLateral, arena);
  const pathRanges = terrainGateLateralRangesForPath(
    startProgress,
    targetProgress,
    arena
  );
  if (
    !pathIntersectsRiver(startProgress, targetProgress, arena) ||
    lateralWithinRanges(sanitizedLateral, pathRanges)
  ) {
    return sanitizedLateral;
  }

  return closestLateralInRanges(sanitizedLateral, pathRanges);
}

export function terrainLimitedProgressForMove(
  startProgress,
  desiredProgress,
  desiredLateral,
  arena = DEFAULT_ARENA_CONFIG
) {
  const normalizedArena = normalizeArenaConfig(arena);
  const start = Number(startProgress);
  const desired = Number(desiredProgress);
  if (!Number.isFinite(start) || !Number.isFinite(desired)) {
    return Number.isFinite(start) ? start : normalizedArena.progressMin;
  }

  let limitedProgress = desired;
  for (const gate of normalizedArena.terrainGates) {
    const gateRanges = gate.passableLateralRanges;
    if (!lateralWithinRanges(sanitizeLateralPosition(desiredLateral, arena), gateRanges)) {
      if (start <= gate.progressMin && desired > gate.progressMin) {
        limitedProgress = Math.min(limitedProgress, gate.progressMin);
      } else if (start >= gate.progressMax && desired < gate.progressMax) {
        limitedProgress = Math.max(limitedProgress, gate.progressMax);
      }
    }
  }

  for (const obstacle of normalizedArena.obstacles) {
    const lateral = sanitizeLateralPosition(desiredLateral, arena);
    const lateralBlocked =
      lateral >= obstacle.lateralMin && lateral <= obstacle.lateralMax;
    if (!lateralBlocked) {
      continue;
    }
    if (start <= obstacle.progressMin && desired > obstacle.progressMin) {
      limitedProgress = Math.min(limitedProgress, obstacle.progressMin);
    } else if (start >= obstacle.progressMax && desired < obstacle.progressMax) {
      limitedProgress = Math.max(limitedProgress, obstacle.progressMax);
    }
  }

  return limitedProgress;
}

export function toWorldProgress(side, viewY, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedArena = normalizeArenaConfig(arena);
  const normalizedY = clamp(
    toNormalizedWorld(viewY, normalizedArena.progressMax),
    0,
    1
  );
  const worldY = Math.round(normalizedY * normalizedArena.progressMax);
  return side === 'left' ? normalizedArena.progressMax - worldY : worldY;
}

export function normalizeDropPoint(side, payload, arena = DEFAULT_ARENA_CONFIG) {
  const normalizedArena = normalizeArenaConfig(arena);
  const hasExactPoint =
    Number.isFinite(Number(payload?.dropX)) &&
    Number.isFinite(Number(payload?.dropY));

  if (!hasExactPoint) {
    return {
      progress: sanitizeLanePosition(
        side,
        toWorldInteger(Number(payload?.lanePosition), normalizedArena.progressMax),
        normalizedArena
      ),
      lateralPosition: normalizedArena.centerLateral
    };
  }

  return {
    progress: sanitizeLanePosition(
      side,
      toWorldProgress(side, Number(payload.dropY), normalizedArena),
      normalizedArena
    ),
    lateralPosition: sanitizeLateralPosition(
      toWorldInteger(Number(payload.dropX), normalizedArena.lateralMax),
      normalizedArena
    )
  };
}

export function distanceBetweenPoints(
  aProgress,
  aLateral,
  bProgress,
  bLateral,
  arena = DEFAULT_ARENA_CONFIG
) {
  const aspectRatio = arenaFieldAspectRatio(arena);
  return Math.hypot(
    aProgress - bProgress,
    (aLateral - bLateral) * aspectRatio
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

export function lateralOffsetForWorldDistance(
  worldDistance,
  arena = DEFAULT_ARENA_CONFIG
) {
  return Number(worldDistance || 0) / arenaFieldAspectRatio(arena);
}

export function terrainGateLateralForProgress(
  progress,
  arena = DEFAULT_ARENA_CONFIG
) {
  const normalizedArena = normalizeArenaConfig(arena);
  const ranges = terrainGateLateralRangesForProgress(progress, normalizedArena);
  if (ranges.length === 0) {
    return [normalizedArena.centerLateral, normalizedArena.centerLateral];
  }
  return [
    Math.min(...ranges.map((range) => range.min)),
    Math.max(...ranges.map((range) => range.max))
  ];
}

export function sanitizeTerrainLateralForProgress(
  progress,
  lateral,
  arena = DEFAULT_ARENA_CONFIG
) {
  const normalizedLateral = sanitizeLateralPosition(lateral, arena);
  const ranges = terrainGateLateralRangesForProgress(progress, arena);
  if (ranges.length === 0) {
    return normalizedLateral;
  }
  if (lateralWithinRanges(normalizedLateral, ranges)) {
    return normalizedLateral;
  }
  return closestLateralInRanges(normalizedLateral, ranges);
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
