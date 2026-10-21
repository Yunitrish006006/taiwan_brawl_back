import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCompatibleRoyaleClient,
  normalizeRoyaleGameContract,
  ROYALE_GAME_CONTRACT
} from '../src/royale/royale_compatibility.js';

test('room contracts normalize both built-in and resource-bound content digests', () => {
  const installedPackContract = {
    ...ROYALE_GAME_CONTRACT,
    gameplayContentDigest: 'a'.repeat(64)
  };

  assert.deepEqual(
    normalizeRoyaleGameContract(installedPackContract),
    installedPackContract
  );
  assert.equal(
    isCompatibleRoyaleClient(installedPackContract, installedPackContract),
    true
  );
  assert.equal(
    isCompatibleRoyaleClient(installedPackContract, {
      ...ROYALE_GAME_CONTRACT,
      gameplayContentDigest: 'b'.repeat(64)
    }),
    false
  );
});

test('protocol ranges allow mutually compatible clients across package versions', () => {
  const olderClient = {
    ...ROYALE_GAME_CONTRACT,
    moduleVersion: '0.1.0',
    protocolVersion: 1,
    compatibleProtocolRange: '>=1 <3',
  };
  const currentServer = {
    ...ROYALE_GAME_CONTRACT,
    moduleVersion: '0.2.0',
    protocolVersion: 2,
    compatibleProtocolRange: '>=1 <3',
  };

  assert.equal(isCompatibleRoyaleClient(olderClient, currentServer), true);
  assert.equal(isCompatibleRoyaleClient({
    ...olderClient,
    compatibleProtocolRange: '>=1 <2',
  }, currentServer), false);
  assert.equal(isCompatibleRoyaleClient({
    ...olderClient,
    rulesetVersion: currentServer.rulesetVersion + 1,
  }, currentServer), false);
  assert.equal(isCompatibleRoyaleClient({
    ...olderClient,
    gameplayContentDigest: 'a'.repeat(64),
  }, currentServer), false);
});

test('room contracts normalize explicit gameplay resource identities and reject ambiguous sets', () => {
  const resource = {
    resourceId: 'game.mini-royale.gameplay-rules',
    version: '1.2.0',
    sha256: 'a'.repeat(64),
  };
  const candidate = {
    ...ROYALE_GAME_CONTRACT,
    gameplayContentDigest: 'b'.repeat(64),
    gameplayResources: [resource],
  };
  assert.deepEqual(
    normalizeRoyaleGameContract(candidate).gameplayResources,
    [resource],
  );
  assert.equal(
    normalizeRoyaleGameContract({
      ...candidate,
      gameplayResources: [{ ...resource, extra: true }],
    }),
    null,
  );
  assert.equal(
    normalizeRoyaleGameContract({
      ...candidate,
      gameplayResources: [resource, resource],
    }),
    null,
  );
});

test('room contracts reject unsupported versions and malformed content digests', () => {
  assert.equal(
    normalizeRoyaleGameContract({
      ...ROYALE_GAME_CONTRACT,
      moduleVersion: 'invalid-version'
    }),
    null
  );
  assert.equal(
    normalizeRoyaleGameContract({
      ...ROYALE_GAME_CONTRACT,
      rulesetId: 'mini-royale-casual'
    }),
    null
  );
  assert.equal(
    normalizeRoyaleGameContract({
      ...ROYALE_GAME_CONTRACT,
      protocolVersion: ROYALE_GAME_CONTRACT.protocolVersion + 1
    }),
    null
  );
  assert.equal(
    normalizeRoyaleGameContract({
      ...ROYALE_GAME_CONTRACT,
      gameplayContentDigest: 'not-a-content-hash'
    }),
    null
  );
});
