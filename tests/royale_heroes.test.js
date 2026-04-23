import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHeroSnapshot,
  listHeroDefinitions,
  listHeroUnitCards,
  normalizeHeroId,
  registerUnitHeroDefinitions
} from '../src/royale_heroes.js';

test('can register unit cards as heroes', () => {
  const customUnitCard = {
    id: 'unit_as_hero_test',
    name: 'Unit As Hero',
    nameZhHant: '單位英雄測試',
    type: 'melee',
    hp: 420,
    damage: 97,
    attackRange: 180,
    attackSpeed: 0.9
  };

  registerUnitHeroDefinitions([customUnitCard]);

  assert.equal(normalizeHeroId('unit_as_hero_test'), 'unit_as_hero_test');
  const snapshot = buildHeroSnapshot('unit_as_hero_test');
  assert.equal(snapshot.id, 'unit_as_hero_test');
  assert.equal(snapshot.sourceKind, 'unit_card');
  assert.equal(snapshot.sourceCardId, 'unit_as_hero_test');
  assert.equal(snapshot.heroAttack.damage, 97);
});

test('base heroes are projected into unit cards', () => {
  const heroCards = listHeroUnitCards();
  const ordinaryCard = heroCards.find((card) => card.id === 'ordinary_person');

  assert.ok(heroCards.length > 0);
  assert.ok(ordinaryCard);
  assert.equal(ordinaryCard.type, 'melee');
  assert.equal(ordinaryCard.spawnCount, 1);
  assert.equal(ordinaryCard.targetRule, 'ground');
});

test('listHeroDefinitions includes dynamically registered unit heroes', () => {
  const customId = 'unit_as_hero_list_test';
  registerUnitHeroDefinitions([
    {
      id: customId,
      name: 'List Hero Test',
      nameZhHant: '清單英雄測試',
      type: 'ranged',
      hp: 360,
      damage: 88,
      attackRange: 240,
      attackSpeed: 1.1
    }
  ]);

  const heroes = listHeroDefinitions();
  assert.ok(heroes.some((hero) => hero.id === customId));
});
