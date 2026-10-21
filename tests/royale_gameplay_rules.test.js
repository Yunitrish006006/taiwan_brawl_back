import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MINI_ROYALE_GAMEPLAY_RULES,
  normalizeMiniRoyaleGameplayRules,
} from '../src/royale/royale_gameplay_rules.js';

test('normalizes the strict, bounded Mini Royale gameplay rules v1 schema', () => {
  assert.deepEqual(
    normalizeMiniRoyaleGameplayRules(DEFAULT_MINI_ROYALE_GAMEPLAY_RULES),
    DEFAULT_MINI_ROYALE_GAMEPLAY_RULES,
  );
  assert.equal(normalizeMiniRoyaleGameplayRules({
    ...DEFAULT_MINI_ROYALE_GAMEPLAY_RULES,
    untrustedScript: 'run()',
  }), null);
  assert.equal(normalizeMiniRoyaleGameplayRules({
    ...DEFAULT_MINI_ROYALE_GAMEPLAY_RULES,
    towerHitPoints: 0,
  }), null);
  assert.equal(normalizeMiniRoyaleGameplayRules({
    ...DEFAULT_MINI_ROYALE_GAMEPLAY_RULES,
    schemaVersion: 2,
  }), null);
});
