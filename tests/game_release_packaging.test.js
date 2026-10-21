import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { signGameCatalog } from '../scripts/sign-game-catalog.mjs';
import { signGameResource } from '../scripts/sign-game-resource.mjs';
import { buildGameReleaseAssets } from '../scripts/package-game-release.mjs';
import {
  exactGameResourcesApiRouteHandler,
  handleGameResourceMediaRequest,
} from '../src/api/game_resources_api.js';
import { ROYALE_GAME_CONTRACT } from '../src/royale/royale_compatibility.js';
import { resolveMiniRoyaleGameplayRules } from '../src/royale/royale_gameplay_resource_loader.js';

async function releaseFixture({
  moduleId = 'game.archery',
  resourceId = 'game.archery.rules',
  payloadBytes = Buffer.from([0, 1, 2, 3, 127, 128, 255]),
  contentType = 'application/octet-stream',
  platforms = ['web'],
  multiplayer,
} = {}) {
  const resourceKeys = generateKeyPairSync('ed25519');
  const resourceMetadata = signGameResource({
    moduleId,
    resourceId,
    version: '1.0.0',
    payload: payloadBytes,
    privateKeyPem: resourceKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signingKeyId: 'archery-resource-1',
    contentType,
    baseUrl: 'https://assets.example.test',
    payloadSchemaVersion: 1,
  });
  const catalogKeys = generateKeyPairSync('ed25519');
  const now = new Date(Date.now() - 60_000);
  const catalogEnvelope = signGameCatalog({
    publisher: 'taiwan-brawl',
    signingKeyId: 'catalog-release-1',
    privateKeyPem: catalogKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    now,
    payload: {
      catalogVersion: 1,
      modules: [{
        moduleId,
        manifestVersion: 1,
        kind: 'game',
        publisher: 'taiwan-brawl',
        displayName: moduleId === 'game.archery' ? 'Archery' : 'Mini Royale',
        description: moduleId === 'game.archery' ? 'Single player game' : 'Multiplayer strategy battle',
        packageVersion: '0.1.0',
        minimumShellVersion: '0.132.0',
        hostApiRange: '>=1.0.0 <2.0.0',
        dependencies: [],
        dataSchemaVersion: 1,
        platforms,
        ...(multiplayer ? { multiplayer } : {}),
        resources: [{
          resourceId: resourceMetadata.resourceId,
          version: resourceMetadata.version,
          kind: 'gameplayData',
          sha256: resourceMetadata.sha256,
          affectsGameplay: true,
          payloadSchemaVersion: resourceMetadata.payloadSchemaVersion,
          dependencies: [],
          platforms,
          downloadUrl: resourceMetadata.downloadUrl,
          byteLength: resourceMetadata.byteLength,
          signature: resourceMetadata.signature,
          signingKeyId: resourceMetadata.signingKeyId,
        }],
      }],
    },
  });
  const entries = buildGameReleaseAssets({
    payload: payloadBytes,
    resource: resourceMetadata,
    catalogEnvelope,
    resourcePublicKeyPem: resourceKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    catalogPublicKeyPem: catalogKeys.publicKey.export({ type: 'spki', format: 'pem' }),
  });
  return {
    payloadBytes,
    resourceMetadata,
    catalogEnvelope,
    resourcePublicKeyPem: resourceKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    catalogPublicKeyPem: catalogKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    catalogPrivateKeyPem: catalogKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    entries,
  };
}

function kvFromBulkEntries(entries) {
  const values = new Map(entries.map((entry) => [
    entry.key,
    entry.base64 ? Buffer.from(entry.value, 'base64') : entry.value,
  ]));
  return {
    async get(key, options) {
      const value = values.get(key);
      if (value == null) return null;
      if (options?.type === 'arrayBuffer' && Buffer.isBuffer(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      }
      return value;
    },
  };
}

function rawPublicKeyBase64Url(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64url');
}

test('release bundle flows from signed bytes through KV contracts to download and catalog API', async () => {
  const fixture = await releaseFixture();
  assert.equal(fixture.entries.length, 3);
  assert.equal(fixture.entries[0].base64, true);
  const kv = kvFromBulkEntries(fixture.entries);

  const mediaUrl = new URL(fixture.resourceMetadata.downloadUrl);
  const mediaResponse = await handleGameResourceMediaRequest(
    new Request(mediaUrl),
    { STATIC_ASSETS: kv },
    mediaUrl,
  );
  assert.equal(mediaResponse.status, 200);
  assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), fixture.payloadBytes);
  assert.equal(mediaResponse.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(mediaResponse.headers.get('ETag'), `"${fixture.resourceMetadata.sha256}"`);

  const catalogUrl = new URL('https://api.example.test/api/games/catalog');
  const catalogHandler = exactGameResourcesApiRouteHandler(
    new Request(catalogUrl),
    { STATIC_ASSETS: kv },
    catalogUrl,
  );
  assert.deepEqual(await (await catalogHandler()).json(), fixture.catalogEnvelope);
});

test('Mini Royale gameplay rules use their own signed module and immutable KV namespace', async () => {
  const payloadBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    rulesetId: 'mini-royale-ranked',
    rulesetVersion: 1,
    matchDurationMs: 210000,
    towerHitPoints: 3000,
    attackSpeedMultiplier: 1.18,
    moveSpeedMultiplier: 0.58,
  }));
  const fixture = await releaseFixture({
    moduleId: 'game.mini-royale',
    resourceId: 'game.mini-royale.gameplay-rules',
    payloadBytes,
    contentType: 'application/json',
    platforms: ['web', 'android', 'ios', 'windows', 'macos', 'linux'],
    multiplayer: {
      protocolVersion: 1,
      compatibleProtocolRange: '>=1 <2',
      rulesetId: 'mini-royale-ranked',
      rulesetVersion: 1,
      gameplayContentDigest: 'builtin-royale-rules-v1',
    },
  });
  const kv = kvFromBulkEntries(fixture.entries);
  const mediaUrl = new URL(fixture.resourceMetadata.downloadUrl);
  const mediaResponse = await handleGameResourceMediaRequest(
    new Request(mediaUrl),
    { STATIC_ASSETS: kv },
    mediaUrl,
  );
  assert.equal(mediaResponse.status, 200);
  assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), payloadBytes);
  assert.match(fixture.entries[0].key, /^game-resource:mini-royale:/);
  assert.match(fixture.entries[1].key, /^game-resource-meta:mini-royale:/);

  const catalogUrl = new URL('https://api.example.test/api/games/catalog');
  const catalogHandler = exactGameResourcesApiRouteHandler(
    new Request(catalogUrl),
    { STATIC_ASSETS: kv },
    catalogUrl,
  );
  const catalog = await (await catalogHandler()).json();
  assert.equal(catalog.payload.modules[0].moduleId, 'game.mini-royale');
  assert.equal(
    catalog.payload.modules[0].resources[0].resourceId,
    'game.mini-royale.gameplay-rules',
  );
  assert.equal(catalog.payload.modules[0].multiplayer.rulesetId, 'mini-royale-ranked');

  const gameplayResources = [{
    resourceId: fixture.resourceMetadata.resourceId,
    version: fixture.resourceMetadata.version,
    sha256: fixture.resourceMetadata.sha256,
  }];
  const canonicalDigest = [
    ROYALE_GAME_CONTRACT.gameplayContentDigest,
    `${gameplayResources[0].resourceId}@${gameplayResources[0].version}:${gameplayResources[0].sha256}`,
  ].join('\n');
  const gameContract = {
    ...ROYALE_GAME_CONTRACT,
    gameplayContentDigest: createHash('sha256').update(canonicalDigest).digest('hex'),
    gameplayResources,
  };
  const rulesResult = await resolveMiniRoyaleGameplayRules(gameContract, {
    STATIC_ASSETS: kv,
    GAME_CATALOG_TRUST_KEYS: JSON.stringify({
      'catalog-release-1': {
        publisher: 'taiwan-brawl',
        publicKey: rawPublicKeyBase64Url(fixture.catalogPublicKeyPem),
      },
      'archery-resource-1': {
        publisher: 'taiwan-brawl',
        publicKey: rawPublicKeyBase64Url(fixture.resourcePublicKeyPem),
      },
    }),
  });
  assert.equal(rulesResult.ok, true, rulesResult.reason);
  assert.deepEqual(rulesResult.rules, JSON.parse(payloadBytes.toString('utf8')));
});

test('release packager fails closed on byte or signed catalog drift', async () => {
  const fixture = await releaseFixture();
  assert.throws(
    () => buildGameReleaseAssets({
      payload: Buffer.from('changed'),
      resource: fixture.resourceMetadata,
      catalogEnvelope: fixture.catalogEnvelope,
      resourcePublicKeyPem: fixture.resourcePublicKeyPem,
      catalogPublicKeyPem: fixture.catalogPublicKeyPem,
    }),
    /digest/,
  );
  const changedPayload = structuredClone(fixture.catalogEnvelope.payload);
  changedPayload.modules[0].resources[0].version = '2.0.0';
  const changedEnvelope = signGameCatalog({
    payload: changedPayload,
    publisher: fixture.catalogEnvelope.publisher,
    signingKeyId: fixture.catalogEnvelope.signingKeyId,
    privateKeyPem: fixture.catalogPrivateKeyPem,
  });
  assert.throws(
    () => buildGameReleaseAssets({
      payload: fixture.payloadBytes,
      resource: fixture.resourceMetadata,
      catalogEnvelope: changedEnvelope,
      resourcePublicKeyPem: fixture.resourcePublicKeyPem,
      catalogPublicKeyPem: fixture.catalogPublicKeyPem,
    }),
    /does not reference this exact resource/,
  );
  assert.throws(
    () => buildGameReleaseAssets({
      payload: fixture.payloadBytes,
      resource: fixture.resourceMetadata,
      catalogEnvelope: fixture.catalogEnvelope,
      resourcePublicKeyPem: fixture.catalogPublicKeyPem,
      catalogPublicKeyPem: fixture.catalogPublicKeyPem,
    }),
    /Resource payload signature does not verify/,
  );
  assert.throws(
    () => buildGameReleaseAssets({
      payload: fixture.payloadBytes,
      resource: fixture.resourceMetadata,
      catalogEnvelope: fixture.catalogEnvelope,
      resourcePublicKeyPem: fixture.resourcePublicKeyPem,
      catalogPublicKeyPem: fixture.resourcePublicKeyPem,
    }),
    /Catalog signature does not verify/,
  );
});

test('release packaging CLI creates a new local artifact without overwriting existing output', async () => {
  const fixture = await releaseFixture();
  const directory = await mkdtemp(join(tmpdir(), 'game-release-package-'));
  try {
    const payloadPath = join(directory, 'resource.bin');
    const resourcePath = join(directory, 'resource.json');
    const catalogPath = join(directory, 'catalog.json');
    const resourcePublicKeyPath = join(directory, 'resource-public.pem');
    const catalogPublicKeyPath = join(directory, 'catalog-public.pem');
    const outputPath = join(directory, 'release.json');
    await Promise.all([
      writeFile(payloadPath, fixture.payloadBytes),
      writeFile(resourcePath, JSON.stringify(fixture.resourceMetadata)),
      writeFile(catalogPath, JSON.stringify(fixture.catalogEnvelope)),
      writeFile(resourcePublicKeyPath, fixture.resourcePublicKeyPem),
      writeFile(catalogPublicKeyPath, fixture.catalogPublicKeyPem),
    ]);
    const scriptPath = fileURLToPath(new URL('../scripts/package-game-release.mjs', import.meta.url));
    const args = [
      scriptPath,
      '--file', payloadPath,
      '--resource-metadata', resourcePath,
      '--catalog-envelope', catalogPath,
      '--resource-public-key', resourcePublicKeyPath,
      '--catalog-public-key', catalogPublicKeyPath,
      '--output', outputPath,
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const entries = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(entries.length, 3);
    const secondRun = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(secondRun.status, 0);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), entries);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
