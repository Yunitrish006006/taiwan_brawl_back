import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';

import { signGameCatalog } from '../scripts/sign-game-catalog.mjs';
import { signGameResource } from '../scripts/sign-game-resource.mjs';
import { resolveMiniRoyaleGameplayRules } from '../src/royale/royale_gameplay_resource_loader.js';
import { RoyaleRoom } from '../src/royale/royale_room.js';

const moduleId = 'game.mini-royale';
const resourceId = `${moduleId}.gameplay-rules`;
const rules = {
  schemaVersion: 1,
  rulesetId: 'mini-royale-ranked',
  rulesetVersion: 1,
  matchDurationMs: 240000,
  towerHitPoints: 4000,
  attackSpeedMultiplier: 1.25,
  moveSpeedMultiplier: 0.7,
};

function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function signedFixture({ payload = Buffer.from(JSON.stringify(rules)), trust = true } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  const resource = signGameResource({
    moduleId,
    resourceId,
    version: '1.2.0',
    payload,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signingKeyId: 'test-key',
    contentType: 'application/json',
    baseUrl: 'https://assets.example.test',
  });
  const resourceManifest = {
    ...resource,
    kind: 'gameplayData',
    affectsGameplay: true,
    dependencies: [],
    required: false,
    platforms: ['web'],
  };
  const catalog = signGameCatalog({
    payload: {
      catalogVersion: 1,
      modules: [{
        moduleId,
        displayName: 'Mini Royale',
        description: 'Test game rules.',
        manifestVersion: 1,
        kind: 'game',
        publisher: 'test-publisher',
        packageVersion: '0.1.0',
        minimumShellVersion: '0.132.0',
        hostApiRange: '>=1.0.0 <2.0.0',
        dependencies: [],
        dataSchemaVersion: 1,
        platforms: ['web'],
        multiplayer: {
          protocolVersion: 1,
          compatibleProtocolRange: '>=1 <2',
          rulesetId: rules.rulesetId,
          rulesetVersion: rules.rulesetVersion,
          gameplayContentDigest: 'builtin-royale-rules-v1',
        },
        resources: [resourceManifest],
      }],
    },
    publisher: 'test-publisher',
    signingKeyId: 'test-key',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  const bytes = Uint8Array.from(payload);
  const meta = JSON.stringify({
    byteLength: bytes.length,
    contentType: 'application/json',
    sha256: resource.sha256,
  });
  const kv = new Map([
    ['game-resource-catalog:v1', JSON.stringify(catalog)],
    [`game-resource:mini-royale:${resourceId}:1.2.0`, bytes.buffer],
    [`game-resource-meta:mini-royale:${resourceId}:1.2.0`, meta],
  ]);
  const env = {
    GAME_CATALOG_TRUST_KEYS: JSON.stringify(trust ? {
      'test-key': {
        publisher: 'test-publisher',
        publicKey: encodeBase64Url(rawPublicKey),
      },
    } : {}),
    STATIC_ASSETS: { get: async (key) => kv.get(key) ?? null },
  };
  const gameplayResources = [{
    resourceId,
    version: '1.2.0',
    sha256: resource.sha256,
  }];
  const canonicalDigestInput = [
    'builtin-royale-rules-v1',
    `${resourceId}@1.2.0:${resource.sha256}`,
  ].join('\n');
  const gameContract = {
    gameId: moduleId,
    moduleVersion: '0.1.0',
    protocolVersion: 1,
    rulesetId: rules.rulesetId,
    rulesetVersion: rules.rulesetVersion,
    gameplayContentDigest: createHash('sha256').update(canonicalDigestInput).digest('hex'),
    gameplayResources,
  };
  return { env, gameContract, kv };
}

test('loads only a trusted, digest-matched gameplay pack and returns its executable rules data', async () => {
  const fixture = await signedFixture();
  const result = await resolveMiniRoyaleGameplayRules(fixture.gameContract, fixture.env);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rules, rules);
});

test('room creation resolves and persists the exact verified rules selected by its contract', async () => {
  const fixture = await signedFixture();
  const values = new Map();
  const state = {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
    },
  };
  const room = new RoyaleRoom(state, fixture.env);
  await room.initialized;
  const response = await room.handleCreate(new Request('https://room.test/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'RULE42',
      user: { id: 7, name: 'Host' },
      deck: { id: 1, name: 'Test Deck', cards: [] },
      gameContract: fixture.gameContract,
      vsBot: false,
      simulationMode: 'server',
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(room.room.gameplayRules, rules);
  assert.deepEqual(values.get('room').gameplayRules, rules);
});

test('fails closed when signing keys are unavailable or the room digest changes', async () => {
  const untrusted = await signedFixture({ trust: false });
  assert.equal((await resolveMiniRoyaleGameplayRules(untrusted.gameContract, untrusted.env)).ok, false);

  const tampered = await signedFixture();
  tampered.gameContract.gameplayContentDigest = 'a'.repeat(64);
  assert.equal((await resolveMiniRoyaleGameplayRules(tampered.gameContract, tampered.env)).ok, false);
});

test('fails closed for malformed or wrongly signed rule payloads', async () => {
  const malformed = await signedFixture({
    payload: Buffer.from(JSON.stringify({ ...rules, executable: 'run()' })),
  });
  assert.equal((await resolveMiniRoyaleGameplayRules(malformed.gameContract, malformed.env)).ok, false);

  const altered = await signedFixture();
  const bytesKey = `game-resource:mini-royale:${resourceId}:1.2.0`;
  altered.env.STATIC_ASSETS.get = async (key) => {
    if (key === bytesKey) return Uint8Array.from(Buffer.from('tampered')).buffer;
    return altered.kv.get(key) ?? null;
  };
  assert.equal((await resolveMiniRoyaleGameplayRules(altered.gameContract, altered.env)).ok, false);
});
