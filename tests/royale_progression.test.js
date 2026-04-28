import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDeckCardsUnlockedForAge,
  cardLockState,
  listProgressionHeroOptions,
  lockedDeckCardsForAge,
  normalizeProgressionHeroId,
  unlockedTiersForAge
} from '../src/royale/royale_progression.js';

test('age gates expose requested card unlock tiers', () => {
  assert.deepEqual(unlockedTiersForAge(0), {
    item: true,
    event: false,
    skill: false,
    unit: false,
    teenUnit: false,
    job: false
  });
  assert.equal(unlockedTiersForAge(8).unit, true);
  assert.equal(unlockedTiersForAge(16).job, true);
});

test('cardLockState follows type and special id unlock ages', () => {
  assert.equal(cardLockState({ id: 'betel_nut', type: 'equipment' }, 0).locked, false);
  assert.equal(cardLockState({ id: 'weather_front', type: 'event' }, 2).locked, true);
  assert.equal(cardLockState({ id: 'weather_front', type: 'event' }, 3).locked, false);
  assert.equal(cardLockState({ id: 'fireball', type: 'spell' }, 4).locked, true);
  assert.equal(cardLockState({ id: 'roadside_elder', type: 'melee' }, 8).locked, false);
  assert.equal(cardLockState({ id: 'delinquent_89', type: 'swarm' }, 13).unlockAge, 14);
  assert.equal(cardLockState({ id: 'convenience_shift', type: 'job' }, 15).locked, true);
});

test('deck unlock validation blocks newly added age locked cards', () => {
  const cards = [
    { id: 'betel_nut', nameEn: 'Betel Nut', type: 'equipment' },
    { id: 'fireball', nameEn: 'Fireball', type: 'spell' },
    { id: 'swordsman', nameEn: 'Swordsman', type: 'melee' }
  ];

  assert.deepEqual(
    lockedDeckCardsForAge(cards, 0).map((card) => card.id),
    ['fireball', 'swordsman']
  );
  assert.throws(
    () => assertDeckCardsUnlockedForAge(cards, 0),
    /Deck contains cards locked for age 0: Fireball \(age 5\), Swordsman \(age 8\)/
  );
  assert.doesNotThrow(() =>
    assertDeckCardsUnlockedForAge(cards, 5, ['swordsman'])
  );
});

test('unknown hero options fall back safely', () => {
  assert.equal(normalizeProgressionHeroId('street_smart'), 'street_smart');
  assert.equal(normalizeProgressionHeroId('bad-id'), 'bad-id');
});

test('unit cards are exposed as deck hero options', () => {
  const options = listProgressionHeroOptions([
    { id: 'swordsman', type: 'melee', name: '劍士', nameEn: 'Swordsman' },
    { id: 'fireball', type: 'spell', name: '火球', nameEn: 'Fireball' },
    { id: 'betel_nut', type: 'equipment', name: '檳榔', nameEn: 'Betel Nut' }
  ]);
  assert.ok(options.some((entry) => entry.id === 'ordinary_person'));
  assert.ok(options.some((entry) => entry.id === 'swordsman' && entry.kind === 'unit_card'));
  assert.equal(options.some((entry) => entry.id === 'fireball'), false);
  assert.equal(options.some((entry) => entry.id === 'betel_nut'), false);
});
