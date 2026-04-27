import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveUnitMovementPlan,
  unitBodyContactDistance,
  unitDesiredLateral
} from '../src/royale_collision_solver.js';
import {
  BRIDGE_MIN_LATERAL,
  RIVER_MIN_PROGRESS,
  distanceBetweenPoints,
  normalizeArenaConfig
} from '../src/royale_battle_rules.js';

function unit(overrides = {}) {
  return {
    id: 'unit',
    side: 'left',
    type: 'melee',
    progress: 200,
    lateralPosition: 500,
    hp: 100,
    bodyRadius: 20,
    moveSpeed: 100,
    collisionBehavior: 'hold',
    ...overrides
  };
}

test('solveUnitMovementPlan separates same-side movers without mutating inputs', () => {
  const back = unit({ id: 'back', progress: 270 });
  const front = unit({ id: 'front', progress: 300 });
  const units = [back, front];
  const plans = units.map((entry) => ({
    unit: entry,
    intendedProgress: entry.progress + 50,
    intendedLateral: entry.lateralPosition,
    progressDelta: 50,
    effectiveMoveSpeed: 100,
    dt: 0.5
  }));

  const solved = solveUnitMovementPlan(units, plans);
  const frontMove = solved.get(front);
  const backMove = solved.get(back);

  assert.equal(front.progress, 300);
  assert.equal(back.progress, 270);
  assert.equal(frontMove.progress, 350);
  assert.ok(
    distanceBetweenPoints(
      frontMove.progress,
      frontMove.lateralPosition,
      backMove.progress,
      backMove.lateralPosition
    ) >= unitBodyContactDistance(front, back)
  );
});

test('solveUnitMovementPlan reroutes only units that opt into reroute behavior', () => {
  const anchor = unit({ id: 'anchor', progress: 326, moveSpeed: 0 });
  const holder = unit({
    id: 'holder',
    progress: 280,
    collisionBehavior: 'hold',
    laneBias: -12
  });
  const rerouter = unit({
    id: 'rerouter',
    type: 'swarm',
    progress: 280,
    collisionBehavior: 'reroute',
    laneBias: -12
  });

  const holdSolved = solveUnitMovementPlan([anchor, holder], [{
    unit: holder,
    intendedProgress: 330,
    intendedLateral: 488,
    progressDelta: 50,
    effectiveMoveSpeed: 100,
    dt: 0.5
  }]).get(holder);
  const rerouteSolved = solveUnitMovementPlan([anchor, rerouter], [{
    unit: rerouter,
    intendedProgress: 330,
    intendedLateral: 488,
    progressDelta: 50,
    effectiveMoveSpeed: 100,
    dt: 0.5
  }]).get(rerouter);

  assert.equal(holdSolved.progress, 280);
  assert.equal(holdSolved.lateralPosition, 500);
  assert.ok(rerouteSolved.progress < 280);
  assert.ok(rerouteSolved.lateralPosition < 500);
});

test('unitDesiredLateral steers future river crossings toward the bridge gate', () => {
  const traveler = unit({ id: 'traveler', progress: 300, lateralPosition: 220 });
  const sameBankTarget = unit({
    id: 'same-bank',
    side: 'right',
    progress: 430,
    lateralPosition: 220
  });
  const farBankTarget = unit({
    id: 'far-bank',
    side: 'right',
    progress: 700,
    lateralPosition: 220
  });

  assert.equal(
    unitDesiredLateral(traveler, { kind: 'unit', target: sameBankTarget }),
    220
  );
  assert.equal(
    unitDesiredLateral(traveler, { kind: 'unit', target: farBankTarget }),
    BRIDGE_MIN_LATERAL
  );
});

test('solveUnitMovementPlan blocks off-bridge entry into the river', () => {
  const traveler = unit({
    id: 'traveler',
    progress: 450,
    lateralPosition: 220
  });
  const solved = solveUnitMovementPlan([traveler], [{
    unit: traveler,
    intendedProgress: 470,
    intendedLateral: 225,
    progressDelta: 20,
    effectiveMoveSpeed: 100,
    dt: 0.2
  }]).get(traveler);

  assert.equal(solved.progress, RIVER_MIN_PROGRESS);
  assert.equal(solved.lateralPosition, 225);
});

test('solveUnitMovementPlan allows river entry once the unit is on the bridge', () => {
  const traveler = unit({
    id: 'traveler',
    progress: RIVER_MIN_PROGRESS,
    lateralPosition: BRIDGE_MIN_LATERAL
  });
  const solved = solveUnitMovementPlan([traveler], [{
    unit: traveler,
    intendedProgress: RIVER_MIN_PROGRESS + 15,
    intendedLateral: BRIDGE_MIN_LATERAL,
    progressDelta: 15,
    effectiveMoveSpeed: 100,
    dt: 0.15
  }]).get(traveler);

  assert.equal(solved.progress, RIVER_MIN_PROGRESS + 15);
  assert.equal(solved.lateralPosition, BRIDGE_MIN_LATERAL);
});

test('solveUnitMovementPlan honors custom arena size and terrain gates', () => {
  const arena = normalizeArenaConfig({
    id: 'tall_bridge_test',
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
    ]
  });
  const traveler = unit({
    id: 'traveler',
    progress: 640,
    lateralPosition: 300
  });
  const solved = solveUnitMovementPlan([traveler], [{
    unit: traveler,
    intendedProgress: 680,
    intendedLateral: 300,
    progressDelta: 40,
    effectiveMoveSpeed: 100,
    dt: 0.4
  }], arena).get(traveler);

  assert.equal(solved.progress, 650);
  assert.equal(solved.lateralPosition, 300);

  const edgeRunner = unit({
    id: 'edge-runner',
    progress: 1390,
    lateralPosition: 600
  });
  const edgeSolved = solveUnitMovementPlan([edgeRunner], [{
    unit: edgeRunner,
    intendedProgress: 1500,
    intendedLateral: 600,
    progressDelta: 110,
    effectiveMoveSpeed: 220,
    dt: 0.5
  }], arena).get(edgeRunner);

  assert.equal(edgeSolved.progress, 1400);
  assert.equal(edgeSolved.lateralPosition, 600);
});
