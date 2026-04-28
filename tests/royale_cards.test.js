import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCardDefinition } from '../src/royale/royale_cards.js';

test('equipment cards default to money cost type', () => {
  const card = normalizeCardDefinition({
    id: 'iron_blade',
    type: 'equipment',
    energyCost: 2
  });

  assert.equal(card.energyCostType, 'money');
});

test('spell cards default to spirit cost type', () => {
  const card = normalizeCardDefinition({
    id: 'zap',
    type: 'spell',
    energyCost: 2
  });

  assert.equal(card.energyCostType, 'spirit');
});
