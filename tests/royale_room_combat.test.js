import test from 'node:test';
import assert from 'node:assert/strict';

import { GLOBAL_MOVE_SPEED_MULTIPLIER } from '../src/royale_battle_rules.js';
import {
  applyEquipmentEffects,
  buildBotPayload,
  chooseBotCombo,
  drawReplacementCards,
  equipmentEffects,
  resolveComboCards
} from '../src/royale_room_combat.js';

test('resolveComboCards validates hand membership and deck membership', () => {
  const player = {
    deckCards: [
      { id: 'knight', type: 'melee' },
      { id: 'boots', type: 'equipment' }
    ]
  };
  const battlePlayer = {
    hand: ['knight', 'boots']
  };
  const errors = [];

  const resolved = resolveComboCards(player, battlePlayer, ['knight', 'boots'], (message) =>
    errors.push(message)
  );

  assert.equal(errors.length, 0);
  assert.deepEqual(
    resolved.map((card) => card.id),
    ['knight', 'boots']
  );
});

test('drawReplacementCards rotates used cards to the queue tail', () => {
  const battlePlayer = {
    hand: ['a', 'b', 'c', 'd'],
    queue: ['e', 'f']
  };

  drawReplacementCards(battlePlayer, ['b', 'd']);

  assert.deepEqual(battlePlayer.hand, ['a', 'c', 'e', 'f']);
  assert.deepEqual(battlePlayer.queue, ['b', 'd']);
});

test('equipmentEffects and applyEquipmentEffects aggregate boosts', () => {
  const effects = equipmentEffects([
    { id: 'blade', name: 'Blade', type: 'equipment', effectKind: 'damage_boost', effectValue: 20 },
    { id: 'boots', name: 'Boots', type: 'equipment', effectKind: 'speed_boost', effectValue: 0.25 }
  ]);

  const applied = applyEquipmentEffects(
    { hp: 100, damage: 40, moveSpeed: 80 },
    effects
  );

  assert.deepEqual(
    effects.map((effect) => effect.name),
    ['Blade', 'Boots']
  );
  assert.equal(applied.hp, 100);
  assert.equal(applied.damage, 60);
  assert.equal(
    applied.moveSpeed,
    Number((80 * GLOBAL_MOVE_SPEED_MULTIPLIER * 1.25).toFixed(4))
  );
});

test('chooseBotCombo prefers affordable unit-first plays', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 3000 },
        right: { towerHp: 3000 }
      },
      units: []
    }
  };
  const player = {
    deckCards: [
      { id: 'knight', type: 'melee', elixirCost: 3, hp: 900, damage: 150, attackRange: 60, moveSpeed: 140, spawnCount: 1, targetRule: 'ground' },
      { id: 'fireball', type: 'spell', elixirCost: 4, spellRadius: 130, spellDamage: 280 },
      { id: 'boots', type: 'equipment', elixirCost: 1, effectKind: 'speed_boost' }
    ]
  };
  const battlePlayer = {
    hand: ['knight', 'fireball', 'boots'],
    elixir: 4
  };

  const combo = chooseBotCombo(room, 'left', player, battlePlayer);

  assert.deepEqual(
    combo.map((card) => card.id),
    ['knight', 'boots']
  );
});

test('chooseBotCombo uses spells to answer clustered pressure near tower', () => {
  const room = {
    battle: {
      players: {
        left: { towerHp: 2400 },
        right: { towerHp: 3000 }
      },
      units: [
        { side: 'right', hp: 220, maxHp: 220, damage: 80, progress: 150, lateralPosition: 480, targetRule: 'ground', type: 'melee' },
        { side: 'right', hp: 220, maxHp: 220, damage: 80, progress: 165, lateralPosition: 510, targetRule: 'ground', type: 'melee' },
        { side: 'right', hp: 220, maxHp: 220, damage: 80, progress: 180, lateralPosition: 495, targetRule: 'ground', type: 'melee' }
      ]
    }
  };
  const player = {
    deckCards: [
      { id: 'knight', type: 'melee', elixirCost: 3, hp: 900, damage: 150, attackRange: 60, moveSpeed: 140, spawnCount: 1, targetRule: 'ground' },
      { id: 'fireball', type: 'spell', elixirCost: 4, spellRadius: 130, spellDamage: 280 },
      { id: 'boots', type: 'equipment', elixirCost: 1, effectKind: 'speed_boost' }
    ]
  };
  const battlePlayer = {
    hand: ['knight', 'fireball', 'boots'],
    elixir: 4
  };

  const combo = chooseBotCombo(room, 'left', player, battlePlayer);

  assert.deepEqual(
    combo.map((card) => card.id),
    ['fireball']
  );
});

test('buildBotPayload positions defensive drops toward the highest-pressure lane', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;

  try {
    const room = {
      battle: {
        players: {
          left: { towerHp: 3000 },
          right: { towerHp: 3000 }
        },
        units: [
          {
            side: 'right',
            hp: 900,
            maxHp: 900,
            damage: 160,
            progress: 170,
            lateralPosition: 650,
            targetRule: 'tower',
            type: 'tank'
          }
        ]
      }
    };

    const payload = buildBotPayload(
      room,
      'left',
      [{ id: 'knight', type: 'melee', attackRange: 60, targetRule: 'ground' }]
    );

    assert.equal(payload.lanePosition, 100);
    assert.equal(payload.dropX, 650);
    assert.equal(payload.dropY, 900);
  } finally {
    Math.random = originalRandom;
  }
});
