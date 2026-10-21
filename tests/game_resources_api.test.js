import test from 'node:test';
import assert from 'node:assert/strict';

import {
  exactGameResourcesApiRouteHandler,
  handleGameResourceMediaRequest,
} from '../src/api/game_resources_api.js';

function memoryKv(initial = new Map()) {
  return {
    async get(key, options) {
      const value = initial.get(key);
      if (value == null) return null;
      if (options?.type === 'arrayBuffer' && typeof value === 'string') {
        return new TextEncoder().encode(value).buffer;
      }
      return value;
    },
  };
}

const request = (url, init) => new Request(url, init);
const signedEnvelope = (payload, overrides = {}) => ({
  envelopeVersion: 1,
  publisher: 'taiwan-brawl',
  signingKeyId: 'catalog-release-1',
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  signature: 'A'.repeat(86),
  payload,
  ...overrides,
});

test('catalog endpoint returns an empty offline-safe catalog when not published', async () => {
  const handler = exactGameResourcesApiRouteHandler(
    request('https://example.test/api/games/catalog'),
    { STATIC_ASSETS: memoryKv() },
    new URL('https://example.test/api/games/catalog'),
  );
  const response = await handler();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { catalogVersion: 1, modules: [] });
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
});

test('catalog endpoint serves published signed manifest envelope', async () => {
  const catalog = signedEnvelope({
    catalogVersion: 1,
    modules: [{
      moduleId: 'game.archery',
      manifestVersion: 1,
      kind: 'game',
      publisher: 'taiwan-brawl',
      displayName: 'Archery',
      description: 'Single-player archery',
      packageVersion: '1.2.0',
      minimumShellVersion: '0.132.0',
      hostApiRange: '>=1.0.0 <2.0.0',
      dependencies: [],
      dataSchemaVersion: 1,
      platforms: ['web', 'android'],
      resources: [{
        resourceId: 'game.archery.map.default',
        version: '1.0.0',
        kind: 'gameplayData',
        sha256: 'a'.repeat(64),
        affectsGameplay: true,
        dependencies: [],
        platforms: ['web'],
        downloadUrl: 'https://assets.example.test/maps/default/1.0.0',
        byteLength: 24,
        signature: 'signed-manifest-entry',
        signingKeyId: 'test-release',
      }],
    }],
  });
  const handler = exactGameResourcesApiRouteHandler(
    request('https://example.test/api/games/catalog'),
    { STATIC_ASSETS: memoryKv(new Map([['game-resource-catalog:v1', JSON.stringify(catalog)]])) },
    new URL('https://example.test/api/games/catalog'),
  );
  assert.deepEqual(await (await handler()).json(), catalog);
});

test('catalog validates unbounded SemVer range components without Number rounding', async () => {
  const catalog = signedEnvelope({
    catalogVersion: 1,
    modules: [{
      moduleId: 'game.archery',
      manifestVersion: 1,
      kind: 'game',
      publisher: 'taiwan-brawl',
      displayName: 'Archery',
      description: 'Single-player archery',
      packageVersion: '1.2.0',
      minimumShellVersion: '0.132.0',
      hostApiRange: '>=1.0.0 <2.0.0',
      dependencies: [{
        kind: 'module',
        id: 'game.chat',
        versionRange: '>=9007199254740992.0.0 <9007199254740993.0.0',
        optional: false,
      }],
      dataSchemaVersion: 1,
      platforms: ['web'],
      resources: [],
    }],
  });
  const handler = exactGameResourcesApiRouteHandler(
    request('https://example.test/api/games/catalog'),
    { STATIC_ASSETS: memoryKv(new Map([['game-resource-catalog:v1', JSON.stringify(catalog)]])) },
    new URL('https://example.test/api/games/catalog'),
  );

  assert.equal((await handler()).status, 200);
});

test('catalog accepts the package-owned Mini Royale arena presentation resource contract', async () => {
  const catalog = signedEnvelope({
    catalogVersion: 1,
    modules: [{
      moduleId: 'game.mini-royale',
      manifestVersion: 1,
      kind: 'game',
      publisher: 'taiwan-brawl',
      displayName: 'Mini Royale',
      description: 'Multiplayer strategy battle',
      packageVersion: '0.1.0',
      minimumShellVersion: '0.132.0',
      hostApiRange: '>=1.0.0 <2.0.0',
      dependencies: [],
      dataSchemaVersion: 1,
      platforms: ['web', 'android', 'ios', 'windows', 'macos', 'linux'],
      resources: [{
        resourceId: 'game.mini-royale.arena-presentation',
        version: '1.0.0',
        kind: 'presentation',
        sha256: 'b'.repeat(64),
        affectsGameplay: false,
        dependencies: [],
        platforms: ['web', 'android', 'ios', 'windows', 'macos', 'linux'],
        downloadUrl: 'https://assets.example.test/mini-royale/arena-presentation/1.0.0',
        byteLength: 128,
        signature: 'signed-resource-entry',
        signingKeyId: 'test-release',
      }],
    }],
  });
  const handler = exactGameResourcesApiRouteHandler(
    request('https://example.test/api/games/catalog'),
    { STATIC_ASSETS: memoryKv(new Map([['game-resource-catalog:v1', JSON.stringify(catalog)]])) },
    new URL('https://example.test/api/games/catalog'),
  );
  const response = await handler();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).payload.modules[0].resources[0].resourceId,
    'game.mini-royale.arena-presentation');
});

test('catalog endpoint rejects malformed or duplicate module/resource manifests', async () => {
  const validModule = {
    moduleId: 'game.archery',
    manifestVersion: 1,
    kind: 'game',
    publisher: 'taiwan-brawl',
    displayName: 'Archery',
    description: 'Single-player archery',
    packageVersion: '1.2.0',
    minimumShellVersion: '0.132.0',
    hostApiRange: '>=1.0.0 <2.0.0',
    dependencies: [],
    dataSchemaVersion: 1,
    platforms: ['web', 'android'],
    resources: [{
      resourceId: 'game.archery.map.default',
      version: '1.0.0',
      kind: 'gameplayData',
      sha256: 'a'.repeat(64),
      affectsGameplay: true,
      dependencies: [],
      platforms: ['web'],
      downloadUrl: 'https://assets.example.test/maps/default/1.0.0',
      byteLength: 24,
      signature: 'signed-manifest-entry',
      signingKeyId: 'test-release',
    }],
  };
  const malformedCatalogs = [
    { modules: [{ ...validModule, packageVersion: 'latest' }] },
    { modules: [{ ...validModule, packageVersion: '1.2.0-01' }] },
    { modules: [{ ...validModule, hostApiRange: '>=2.0.0 <1.0.0' }] },
    { modules: [{ ...validModule, dependencies: [{ kind: 'module', id: 'game.archery', versionRange: '>=1.0.0 <2.0.0', optional: false }] }] },
    { modules: [{ ...validModule, dependencies: [{ kind: 'module', id: 'game.chat', versionRange: '>=1.0.0 <1.0.0', optional: false }] }] },
    { modules: [{ ...validModule, publisher: '' }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], sha256: 'bad' }] }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], version: '1.0.0-alpha..bad' }] }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], downloadUrl: 'http://assets.example.test/map' }] }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], signingKeyId: '' }] }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], dependencies: [{ kind: 'resource', id: validModule.resources[0].resourceId, versionRange: '>=1.0.0 <2.0.0', optional: false }] }] }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], activationGroup: 'Not Valid' }] }] },
    { modules: [{ ...validModule, platforms: ['ios', 'ios'] }] },
    { modules: [{ ...validModule, resources: [{ ...validModule.resources[0], platforms: ['linux'] }] }] },
    { modules: [validModule, validModule] },
    { modules: [{ ...validModule, resources: [validModule.resources[0], validModule.resources[0]] }] },
  ];

  for (const catalog of malformedCatalogs) {
    const handler = exactGameResourcesApiRouteHandler(
      request('https://example.test/api/games/catalog'),
      { STATIC_ASSETS: memoryKv(new Map([['game-resource-catalog:v1', JSON.stringify(signedEnvelope({ catalogVersion: 1, ...catalog }))]])) },
      new URL('https://example.test/api/games/catalog'),
    );
    assert.equal((await handler()).status, 503);
  }
});

test('resource byte routes reject invalid SemVer prerelease identifiers', async () => {
  const url = new URL(
    'https://example.test/game-resources/archery/maps/1.0.0-01',
  );
  assert.equal(
    await handleGameResourceMediaRequest(request(url), resourceEnv(), url),
    null,
  );
});

test('catalog endpoint rejects unsigned and expired envelopes', async () => {
  const payload = { catalogVersion: 1, modules: [] };
  const catalogs = [
    payload,
    signedEnvelope(payload, { expiresAt: '2000-01-01T00:00:00.000Z' }),
  ];
  for (const catalog of catalogs) {
    const handler = exactGameResourcesApiRouteHandler(
      request('https://example.test/api/games/catalog'),
      { STATIC_ASSETS: memoryKv(new Map([['game-resource-catalog:v1', JSON.stringify(catalog)]])) },
      new URL('https://example.test/api/games/catalog'),
    );
    assert.equal((await handler()).status, 503);
  }
});

test('catalog endpoint fails closed for malformed published JSON', async () => {
  const handler = exactGameResourcesApiRouteHandler(
    request('https://example.test/api/games/catalog'),
    { STATIC_ASSETS: memoryKv(new Map([['game-resource-catalog:v1', '{']] )) },
    new URL('https://example.test/api/games/catalog'),
  );
  const response = await handler();
  assert.equal(response.status, 503);
});

function resourceEnv() {
  const payload = new TextEncoder().encode('abcdefgh');
  const hex = [...payload].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const values = new Map([
    ['game-resource-meta:archery:maps:1.0.0', JSON.stringify({
      byteLength: payload.byteLength,
      contentType: 'application/octet-stream',
      sha256: hex.padEnd(64, '0'),
    })],
    ['game-resource:archery:maps:1.0.0', payload.buffer],
  ]);
  return { STATIC_ASSETS: { async get(key) { return values.get(key) ?? null; } } };
}

test('immutable resource media supports complete and byte-range reads', async () => {
  const url = new URL('https://example.test/game-resources/archery/maps/1.0.0');
  const full = await handleGameResourceMediaRequest(request(url), resourceEnv(), url);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'abcdefgh');
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.match(full.headers.get('Cache-Control'), /immutable/);

  const ranged = await handleGameResourceMediaRequest(
    request(url, { headers: { Range: 'bytes=2-5' } }), resourceEnv(), url,
  );
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 2-5/8');
  assert.equal(await ranged.text(), 'cdef');
});

test('invalid or unsatisfiable resource ranges return 416', async () => {
  const url = new URL('https://example.test/game-resources/archery/maps/1.0.0');
  const response = await handleGameResourceMediaRequest(
    request(url, { headers: { Range: 'bytes=99-' } }), resourceEnv(), url,
  );
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), 'bytes */8');
});
