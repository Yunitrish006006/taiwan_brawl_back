import test from 'node:test';
import assert from 'node:assert/strict';

import {
  regenerateBattleResources,
  resolveSpellEffect,
  spawnBattleUnits,
  tickHeroAttacks,
  tickBattleUnits,
  towerHitPoints,
  winnerSideFromTowers
} from '../src/royale/royale_room_runtime.js';
import {
  distanceBetweenPoints,
  minimumBodyContactDistance,
  UNIT_COLLISION_GAP
} from '../src/royale/royale_battle_rules.js';

test('regenerateBattleResources increases both players and clamps to max', () => {
  const room = {
    battle: {
      players: {
        left: {
          physicalEnergy: 4.9,
          maxPhysicalEnergy: 5,
          physicalEnergyRegen: 0.8,
          spiritEnergy: 2,
          maxSpiritEnergy: 3,
          spiritEnergyRegen: 0,
          money: 0,
          maxMoney: 0,
          moneyPerSecond: 0,
          physicalHealth: 1000,
          maxPhysicalHealth: 1000,
          physicalHealthRegen: 0,
          spiritHealth: 0,
          maxSpiritHealth: 0,
          spiritHealthRegen: 0
        },
        right: {
          physicalEnergy: 0,
          maxPhysicalEnergy: 5,
          physicalEnergyRegen: 0.8,
          spiritEnergy: 0,
          maxSpiritEnergy: 3,
          spiritEnergyRegen: 0,
          money: 0,
          maxMoney: 0,
          moneyPerSecond: 0,
          physicalHealth: 1000,
          maxPhysicalHealth: 1000,
          physicalHealthRegen: 0,
          spiritHealth: 0,
          maxSpiritHealth: 0,
          spiritHealthRegen: 0
        }
      }
    }
  };

  regenerateBattleResources(room, 1);

  assert.equal(room.battle.players.left.physicalEnergy, 5);
  assert.equal(room.battle.players.right.physicalEnergy, 0.8);
});

test('resolveSpellEffect damages enemy units and tower in range', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        { side: 'right', progress: 860, lateralPosition: 500, hp: 100 },
        { side: 'left', progress: 860, lateralPosition: 500, hp: 100 }
      ]
    }
  };

  resolveSpellEffect(
    room,
    'left',
    { spellRadius: 80, spellDamage: 50 },
    { progress: 860, lateralPosition: 500 }
  );

  assert.equal(room.battle.units[0].hp, 50);
  assert.equal(room.battle.units[1].hp, 100);
  assert.equal(room.battle.players.right.towerHp, 950);
});

test('resolveSpellEffect counts the target body radius at the edge of the spell', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          side: 'right',
          type: 'melee',
          progress: 924,
          lateralPosition: 500,
          hp: 100,
          bodyRadius: 18
        }
      ]
    }
  };

  resolveSpellEffect(
    room,
    'left',
    { spellRadius: 10, spellDamage: 40 },
    { progress: 950, lateralPosition: 500 }
  );

  assert.equal(room.battle.units[0].hp, 60);
});

test('health tracks are independent and either zero track defeats the player', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 2000 },
        right: {
          physicalHealth: 1000,
          maxPhysicalHealth: 1000,
          physicalHealthRegen: 0,
          spiritHealth: 40,
          maxSpiritHealth: 1000,
          spiritHealthRegen: 0,
          physicalEnergy: 0,
          maxPhysicalEnergy: 0,
          physicalEnergyRegen: 0,
          spiritEnergy: 0,
          maxSpiritEnergy: 0,
          spiritEnergyRegen: 0,
          money: 0,
          maxMoney: 0,
          moneyPerSecond: 0,
          towerHp: 1040,
          maxTowerHp: 2000
        }
      },
      units: []
    }
  };

  resolveSpellEffect(
    room,
    'left',
    { spellRadius: 80, spellDamage: 50 },
    { progress: 950, lateralPosition: 500 }
  );

  const state = towerHitPoints(room);
  assert.equal(room.battle.players.right.spiritHealth, 0);
  assert.equal(room.battle.players.right.physicalHealth, 1000);
  assert.equal(room.battle.players.right.towerHp, 1000);
  assert.equal(state.rightDefeated, true);
  assert.equal(winnerSideFromTowers(state), 'left');
});

test('hero attacks nearby enemy units defensively', () => {
  const room = {
    players: {
      left: { heroId: 'ordinary_person' },
      right: { heroId: 'ordinary_person' }
    },
    battle: {
      players: {
        left: { heroAttackCooldown: 0 },
        right: { heroAttackCooldown: 0 }
      },
      units: [
        {
          id: 'unit-near',
          side: 'right',
          type: 'melee',
          progress: 190,
          lateralPosition: 500,
          hp: 100,
          bodyRadius: 18
        },
        {
          id: 'unit-far',
          side: 'right',
          type: 'melee',
          progress: 500,
          lateralPosition: 500,
          hp: 100,
          bodyRadius: 18
        }
      ]
    }
  };

  tickHeroAttacks(room, 0.1);

  assert.equal(room.battle.units.find((unit) => unit.id === 'unit-near').hp, 36);
  assert.equal(room.battle.units.find((unit) => unit.id === 'unit-far').hp, 100);
  assert.equal(room.battle.players.left.heroAttackCooldown, 1.25);
  assert.deepEqual(room.battle.players.left.heroAttackEvent, {
    id: 1,
    animation: 'attack',
    targetUnitId: 'unit-near',
    damage: 64,
    damageType: 'physical'
  });
});

test('spawnBattleUnits creates localized units with effects and spacing', () => {
  const room = {
    players: {
      left: { heroId: 'low_income_household' }
    },
    battle: {
      units: [],
      nextUnitId: 1
    }
  };

  spawnBattleUnits(
    room,
    'left',
    {
      id: 'wolf',
      name: 'Wolf',
      nameEn: 'Wolf',
      nameJa: 'オオカミ',
      type: 'melee',
      spawnCount: 2,
      hp: 120,
      damage: 30,
      attackRange: 20,
      moveSpeed: 100,
      attackSpeed: 1,
      targetRule: 'ground'
    },
    { progress: 200, lateralPosition: 500 },
    [{ name: 'Boots', kind: 'speed_boost', value: 0.2 }]
  );

  assert.equal(room.battle.units.length, 2);
  assert.equal(room.battle.units[0].effects[0], 'Boots');
  assert.equal(room.battle.units[0].damage, 35);
  assert.notEqual(room.battle.units[0].lateralPosition, room.battle.units[1].lateralPosition);
  assert.ok(
    distanceBetweenPoints(
      room.battle.units[0].progress,
      room.battle.units[0].lateralPosition,
      room.battle.units[1].progress,
      room.battle.units[1].lateralPosition
    ) >=
      minimumBodyContactDistance(
        room.battle.units[0].bodyRadius,
        room.battle.units[1].bodyRadius,
        UNIT_COLLISION_GAP
      )
  );
});

test('tickBattleUnits moves units and resolves attacks', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          side: 'left',
          type: 'melee',
          progress: 200,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 40,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          side: 'right',
          type: 'melee',
          progress: 230,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 30,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        }
      ]
    }
  };

  tickBattleUnits(room, 0.1);

  assert.equal(room.battle.units[1].hp, 60);
  assert.equal(room.battle.units[0].hp, 70);
  assert.equal(room.battle.units[0].animationState, 'idle');
  assert.equal(room.battle.units[1].animationState, 'idle');
  assert.deepEqual(room.battle.units[0].animationEvent, {
    animation: 'attack',
    id: 1
  });
  assert.deepEqual(room.battle.units[1].animationEvent, {
    animation: 'attack',
    id: 1
  });

  tickBattleUnits(room, 0.1);

  assert.equal(room.battle.units[1].hp, 60);
  assert.equal(room.battle.units[0].hp, 70);
  assert.equal(room.battle.units[0].animationEvent.id, 1);
  assert.equal(room.battle.units[1].animationEvent.id, 1);
});

test('tickBattleUnits prevents overlapping allied movers', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          id: 'front',
          side: 'left',
          type: 'melee',
          progress: 300,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          id: 'back',
          side: 'left',
          type: 'melee',
          progress: 270,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        }
      ]
    }
  };

  tickBattleUnits(room, 0.5);

  const front = room.battle.units.find((unit) => unit.id === 'front');
  const back = room.battle.units.find((unit) => unit.id === 'back');
  assert.equal(front.progress, 350);
  assert.ok(
    distanceBetweenPoints(
      front.progress,
      front.lateralPosition,
      back.progress,
      back.lateralPosition
    ) >= minimumBodyContactDistance(front.bodyRadius, back.bodyRadius, UNIT_COLLISION_GAP)
  );
});

test('tickBattleUnits allows opposing zero-range units to meet at body contact', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          id: 'left-unit',
          side: 'left',
          type: 'melee',
          progress: 200,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 20,
          attackRange: 0,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          id: 'right-unit',
          side: 'right',
          type: 'melee',
          progress: 300,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 20,
          attackRange: 0,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        }
      ]
    }
  };

  tickBattleUnits(room, 0.5);

  const leftUnit = room.battle.units.find((unit) => unit.id === 'left-unit');
  const rightUnit = room.battle.units.find((unit) => unit.id === 'right-unit');
  assert.equal(
    distanceBetweenPoints(
      leftUnit.progress,
      leftUnit.lateralPosition,
      rightUnit.progress,
      rightUnit.lateralPosition
    ),
    minimumBodyContactDistance(leftUnit.bodyRadius, rightUnit.bodyRadius, 0)
  );
});

test('tickBattleUnits keeps wide allied formations advancing without straight-line fallback', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          id: 'left-wing',
          side: 'left',
          type: 'melee',
          progress: 300,
          lateralPosition: 425,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0,
          laneBias: -75
        },
        {
          id: 'center',
          side: 'left',
          type: 'melee',
          progress: 300,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0,
          laneBias: 0
        },
        {
          id: 'right-wing',
          side: 'left',
          type: 'melee',
          progress: 300,
          lateralPosition: 575,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0,
          laneBias: 75
        }
      ]
    }
  };

  tickBattleUnits(room, 0.5);

  for (const unit of room.battle.units) {
    assert.ok(unit.progress > 300);
  }
  for (let i = 0; i < room.battle.units.length; i += 1) {
    for (let j = i + 1; j < room.battle.units.length; j += 1) {
      assert.ok(
        distanceBetweenPoints(
          room.battle.units[i].progress,
          room.battle.units[i].lateralPosition,
          room.battle.units[j].progress,
          room.battle.units[j].lateralPosition
        ) >=
          minimumBodyContactDistance(
            room.battle.units[i].bodyRadius,
            room.battle.units[j].bodyRadius,
            UNIT_COLLISION_GAP
          )
      );
    }
  }
});

test('tickBattleUnits keeps hold movers planted behind allied blockers', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          id: 'front-holder',
          side: 'left',
          type: 'melee',
          progress: 326,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 0,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          id: 'rear-holder',
          side: 'left',
          type: 'melee',
          progress: 280,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          collisionBehavior: 'hold',
          cooldown: 0,
          laneBias: -12
        }
      ]
    }
  };

  tickBattleUnits(room, 0.5);

  const rearHolder = room.battle.units.find((unit) => unit.id === 'rear-holder');
  assert.equal(rearHolder.progress, 280);
  assert.equal(rearHolder.lateralPosition, 500);
});

test('tickBattleUnits reroutes selected movers backward and outward', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          id: 'front-anchor',
          side: 'left',
          type: 'melee',
          progress: 326,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 0,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          id: 'rear-rerouter',
          side: 'left',
          type: 'swarm',
          progress: 280,
          lateralPosition: 500,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          collisionBehavior: 'reroute',
          cooldown: 0,
          laneBias: -12
        }
      ]
    }
  };

  tickBattleUnits(room, 0.5);

  const frontAnchor = room.battle.units.find((unit) => unit.id === 'front-anchor');
  const rearRerouter = room.battle.units.find((unit) => unit.id === 'rear-rerouter');
  assert.ok(rearRerouter.progress < 280);
  assert.ok(rearRerouter.lateralPosition < 500);
  assert.ok(
    distanceBetweenPoints(
      frontAnchor.progress,
      frontAnchor.lateralPosition,
      rearRerouter.progress,
      rearRerouter.lateralPosition
    ) >=
      minimumBodyContactDistance(
        frontAnchor.bodyRadius,
        rearRerouter.bodyRadius,
        UNIT_COLLISION_GAP
      )
  );
});

test('tickBattleUnits preserves lane bias for three allied movers', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 1000 }
      },
      units: [
        {
          id: 'left-lane',
          side: 'left',
          type: 'melee',
          progress: 200,
          lateralPosition: 450,
          laneBias: -50,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          id: 'mid-lane',
          side: 'left',
          type: 'melee',
          progress: 200,
          lateralPosition: 500,
          laneBias: 0,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        },
        {
          id: 'right-lane',
          side: 'left',
          type: 'melee',
          progress: 200,
          lateralPosition: 550,
          laneBias: 50,
          hp: 100,
          maxHp: 100,
          damage: 0,
          attackRange: 20,
          bodyRadius: 20,
          moveSpeed: 100,
          attackSpeed: 1,
          targetRule: 'ground',
          cooldown: 0
        }
      ]
    }
  };

  for (let index = 0; index < 5; index += 1) {
    tickBattleUnits(room, 0.2);
  }

  const [leftLane, midLane, rightLane] = room.battle.units;
  assert.ok(leftLane.progress > 200);
  assert.ok(midLane.progress > 200);
  assert.ok(rightLane.progress > 200);
  assert.ok(leftLane.lateralPosition < 480);
  assert.ok(rightLane.lateralPosition > 520);
});

test('towerHitPoints and winnerSideFromTowers summarize battle state', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 1000 },
        right: { towerHp: 0 }
      }
    }
  };

  const { leftTowerHp, rightTowerHp } = towerHitPoints(room);

  assert.equal(leftTowerHp, 1000);
  assert.equal(rightTowerHp, 0);
  assert.equal(winnerSideFromTowers(leftTowerHp, rightTowerHp), 'left');
});
