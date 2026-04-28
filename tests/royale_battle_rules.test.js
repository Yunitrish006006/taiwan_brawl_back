import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTER_LATERAL,
  BRIDGE_MAX_LATERAL,
  BRIDGE_MIN_LATERAL,
  DEFAULT_ARENA_ID,
  DOUBLE_BRIDGE_ARENA_ID,
  DOUBLE_BRIDGE_LEFT_MAX_LATERAL,
  DOUBLE_BRIDGE_RIGHT_MIN_LATERAL,
  FIELD_ASPECT_RATIO,
  LATERAL_MAX,
  LATERAL_MIN,
  RIVER_MAX_PROGRESS,
  RIVER_MIN_PROGRESS,
  SIDE_BRIDGES_ARENA_ID,
  TRIPLE_BRIDGE_ARENA_ID,
  UNIT_COLLISION_GAP,
  WIDE_BRIDGE_ARENA_ID,
  arenaConfigById,
  bodyRadiusForUnitType,
  distanceBetweenPoints,
  effectiveAttackReachToTower,
  effectiveAttackReachToUnit,
  effectiveSpellReachToTower,
  effectiveSpellReachToUnit,
  lateralOffsetForWorldDistance,
  listArenaConfigs,
  minimumBodyContactDistance,
  normalizeArenaConfig,
  normalizeDropPoint,
  normalizeSimulationMode,
  randomArenaConfig,
  sanitizeLateralPosition,
  sanitizeTerrainLateralForProgress,
  terrainGateLateralForProgress,
  terrainLimitedProgressForMove,
  terrainNavigationLateralForMove
} from '../src/royale/royale_battle_rules.js';

test('normalizeDropPoint maps normalized viewport coordinates into world space', () => {
  const leftPoint = normalizeDropPoint('left', { dropX: 0.5, dropY: 0.75 });
  assert.deepEqual(leftPoint, {
    progress: 250,
    lateralPosition: 500
  });

  const rightPoint = normalizeDropPoint('right', { dropX: 0.9, dropY: 0.2 });
  assert.deepEqual(rightPoint, {
    progress: 580,
    lateralPosition: 900
  });
});

test('normalizeDropPoint falls back to lanePosition and center lateral', () => {
  const point = normalizeDropPoint('left', { lanePosition: 0.4 });
  assert.equal(point.progress, 400);
  assert.equal(point.lateralPosition, CENTER_LATERAL);
});

test('distance and attack reach calculations include body radius', () => {
  const unit = { type: 'melee', attackRange: 100, bodyRadius: 18 };
  const target = { type: 'tank', bodyRadius: 24 };

  assert.equal(bodyRadiusForUnitType('swarm'), 14);
  assert.equal(effectiveAttackReachToUnit(unit, target), 142);
  assert.equal(effectiveAttackReachToTower(unit), 148);
  assert.equal(effectiveSpellReachToUnit(80, target), 104);
  assert.equal(effectiveSpellReachToTower(80), 110);
  assert.equal(
    minimumBodyContactDistance(unit.bodyRadius, target.bodyRadius, UNIT_COLLISION_GAP),
    48
  );
  assert.equal(lateralOffsetForWorldDistance(31), 31 / FIELD_ASPECT_RATIO);
  assert.equal(distanceBetweenPoints(100, 200, 100, 200), 0);
  assert.ok(distanceBetweenPoints(100, 200, 200, 200) > 0);
});

test('simulation mode normalization and lateral clamping stay bounded', () => {
  assert.equal(normalizeSimulationMode('HOST'), 'host');
  assert.equal(normalizeSimulationMode('server'), 'server');
  assert.equal(normalizeSimulationMode('weird'), 'server');
  assert.equal(sanitizeLateralPosition(-100), LATERAL_MIN);
  assert.equal(sanitizeLateralPosition(5000), LATERAL_MAX);
});

test('terrain helpers gate river crossings through the bridge', () => {
  assert.deepEqual(terrainGateLateralForProgress(500), [
    BRIDGE_MIN_LATERAL,
    BRIDGE_MAX_LATERAL
  ]);
  assert.deepEqual(terrainGateLateralForProgress(RIVER_MIN_PROGRESS), [
    LATERAL_MIN,
    LATERAL_MAX
  ]);
  assert.deepEqual(terrainGateLateralForProgress(RIVER_MAX_PROGRESS), [
    LATERAL_MIN,
    LATERAL_MAX
  ]);
  assert.equal(
    sanitizeTerrainLateralForProgress(500, 120),
    BRIDGE_MIN_LATERAL
  );
  assert.equal(
    sanitizeTerrainLateralForProgress(RIVER_MIN_PROGRESS, 120),
    120
  );
  assert.equal(
    terrainLimitedProgressForMove(450, 470, 220),
    RIVER_MIN_PROGRESS
  );
  assert.equal(terrainLimitedProgressForMove(450, 470, 390), 470);
  assert.equal(
    terrainNavigationLateralForMove(300, 700, 220),
    BRIDGE_MIN_LATERAL
  );
  assert.equal(terrainNavigationLateralForMove(300, 430, 220), 220);
});

test('arena catalog supports random dual-bridge maps with separated bridge lanes', () => {
  const arenaIds = listArenaConfigs().map((arena) => arena.id);
  assert.ok(arenaIds.includes(DEFAULT_ARENA_ID));
  assert.ok(arenaIds.includes(DOUBLE_BRIDGE_ARENA_ID));
  assert.ok(arenaIds.includes(WIDE_BRIDGE_ARENA_ID));
  assert.ok(arenaIds.includes(SIDE_BRIDGES_ARENA_ID));
  assert.ok(arenaIds.includes(TRIPLE_BRIDGE_ARENA_ID));
  assert.equal(randomArenaConfig(() => 0).id, DEFAULT_ARENA_ID);
  assert.equal(randomArenaConfig(() => 0.25).id, DOUBLE_BRIDGE_ARENA_ID);
  assert.equal(randomArenaConfig(() => 0.99).id, TRIPLE_BRIDGE_ARENA_ID);

  const arena = arenaConfigById(DOUBLE_BRIDGE_ARENA_ID);
  assert.equal(arena.terrainGates[0].passableLateralRanges.length, 2);
  assert.equal(
    sanitizeTerrainLateralForProgress(500, 500, arena),
    DOUBLE_BRIDGE_LEFT_MAX_LATERAL
  );
  assert.equal(
    terrainNavigationLateralForMove(300, 700, 500, arena),
    DOUBLE_BRIDGE_LEFT_MAX_LATERAL
  );
  assert.equal(
    sanitizeTerrainLateralForProgress(
      500,
      DOUBLE_BRIDGE_RIGHT_MIN_LATERAL + 20,
      arena
    ),
    DOUBLE_BRIDGE_RIGHT_MIN_LATERAL + 20
  );
  assert.equal(
    terrainLimitedProgressForMove(450, 470, 500, arena),
    RIVER_MIN_PROGRESS
  );
  assert.equal(terrainLimitedProgressForMove(450, 470, 300, arena), 470);
});

test('arena helpers support custom size, gates, and rectangular obstacles', () => {
  const arena = normalizeArenaConfig({
    id: 'wide_test',
    width: 1200,
    height: 1400,
    progressMax: 1400,
    lateralMax: 1200,
    centerLateral: 600,
    fieldAspectRatio: 0.75,
    towers: {
      left: { progress: 100, lateralPosition: 600 },
      right: { progress: 1300, lateralPosition: 600 }
    },
    deploy: {
      left: { min: 0, max: 540 },
      right: { min: 860, max: 1400 }
    },
    terrainGates: [
      {
        id: 'wide_river',
        kind: 'river',
        progressMin: 650,
        progressMax: 750,
        passableLateralRanges: [{ min: 500, max: 700 }]
      }
    ],
    obstacles: [
      {
        id: 'center_block',
        progressMin: 600,
        progressMax: 650,
        lateralMin: 100,
        lateralMax: 200
      }
    ]
  });

  assert.equal(arena.progressMax, 1400);
  assert.equal(arena.lateralMax, 1200);
  assert.equal(sanitizeLateralPosition(2000, arena), 1200);
  assert.equal(
    normalizeDropPoint('left', { lanePosition: 0.5 }, arena).progress,
    540
  );
  assert.equal(sanitizeTerrainLateralForProgress(700, 300, arena), 500);
  assert.equal(terrainNavigationLateralForMove(500, 900, 300, arena), 500);
  assert.equal(terrainLimitedProgressForMove(640, 670, 300, arena), 650);
  assert.equal(terrainLimitedProgressForMove(500, 620, 150, arena), 600);
  assert.equal(distanceBetweenPoints(0, 0, 0, 100, arena), 75);
});
