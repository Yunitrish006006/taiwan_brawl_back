import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTER_LATERAL,
  LATERAL_MAX,
  LATERAL_MIN,
  bodyRadiusForUnitType,
  distanceBetweenPoints,
  effectiveAttackReachToTower,
  effectiveAttackReachToUnit,
  normalizeDropPoint,
  normalizeSimulationMode,
  sanitizeLateralPosition
} from '../src/royale_battle_rules.js';

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
