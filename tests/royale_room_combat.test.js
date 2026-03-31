import test from 'node:test';
import assert from 'node:assert/strict';

import { GLOBAL_MOVE_SPEED_MULTIPLIER } from '../src/royale_battle_rules.js';
import {
  applyEquipmentEffects,
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
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    const player = {
      deckCards: [
        { id: 'knight', type: 'melee', elixirCost: 3 },
        { id: 'fireball', type: 'spell', elixirCost: 4 },
        { id: 'boots', type: 'equipment', elixirCost: 1 }
      ]
    };
    const battlePlayer = {
      hand: ['knight', 'fireball', 'boots'],
      elixir: 4
    };

    const combo = chooseBotCombo(player, battlePlayer);

    assert.deepEqual(
      combo.map((card) => card.id),
      ['knight', 'boots']
    );
  } finally {
    Math.random = originalRandom;
  }
});
