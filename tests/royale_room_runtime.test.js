import test from 'node:test';
import assert from 'node:assert/strict';

import {
  replenishBattleElixir,
  resolveSpellEffect,
  spawnBattleUnits,
  tickBattleUnits,
  towerHitPoints,
  winnerSideFromTowers
} from '../src/royale_room_runtime.js';

test('replenishBattleElixir increases both players and clamps to max', () => {
  const room = {
    battle: {
      players: {
        left: { elixir: 9.9 },
        right: { elixir: 0 }
      }
    }
  };

  replenishBattleElixir(room, 1);

  assert.equal(room.battle.players.left.elixir, 10);
  assert.equal(room.battle.players.right.elixir, 0.8);
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

test('spawnBattleUnits creates localized units with effects and spacing', () => {
  const room = {
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
  assert.notEqual(room.battle.units[0].lateralPosition, room.battle.units[1].lateralPosition);
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
