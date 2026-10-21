import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  canonicalResourceMessage,
  signGameResource,
} from '../scripts/sign-game-resource.mjs';
import { validatePublishedGameResourceCatalog } from '../src/api/game_resources_api.js';

test('resource signer derives immutable metadata and an Ed25519 signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from('{"rulesVersion":1}', 'utf8');
  const signed = signGameResource({
    moduleId: 'game.archery',
    resourceId: 'game.archery.rules',
    version: '1.0.0',
    payload,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signingKeyId: 'resource-release-2026-01',
    contentType: 'application/json',
    baseUrl: 'https://assets.example.test',
    payloadSchemaVersion: 1,
  });
  assert.equal(signed.byteLength, payload.byteLength);
  assert.equal(signed.payloadSchemaVersion, 1);
  assert.equal(signed.sha256.length, 64);
  assert.equal(signed.contentKey, 'game-resource:archery:game.archery.rules:1.0.0');
  assert.equal(signed.metadataKey, 'game-resource-meta:archery:game.archery.rules:1.0.0');
  assert.equal(signed.downloadUrl, 'https://assets.example.test/game-resources/archery/game.archery.rules/1.0.0');
  assert.deepEqual(signed.storageMetadata, {
    byteLength: payload.byteLength,
    contentType: 'application/json',
    sha256: signed.sha256,
  });
  const catalogEnvelope = {
    envelopeVersion: 1,
    publisher: 'taiwan-brawl',
    signingKeyId: 'catalog-test-key',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    signature: 'A'.repeat(86),
    payload: {
      catalogVersion: 1,
      modules: [{
        moduleId: 'game.archery',
        manifestVersion: 1,
        kind: 'game',
        publisher: 'taiwan-brawl',
        displayName: 'Archery',
        description: 'Archery resource test',
        packageVersion: '0.1.0',
        minimumShellVersion: '0.132.0',
        hostApiRange: '>=1.0.0 <2.0.0',
        dependencies: [],
        dataSchemaVersion: 1,
        platforms: ['web'],
        resources: [{
          resourceId: signed.resourceId,
          version: signed.version,
          kind: 'gameplayData',
          sha256: signed.sha256,
          affectsGameplay: true,
          payloadSchemaVersion: 1,
          dependencies: [],
          platforms: ['web'],
          downloadUrl: signed.downloadUrl,
          byteLength: signed.byteLength,
          signature: signed.signature,
          signingKeyId: signed.signingKeyId,
        }],
      }],
    },
  };
  assert.equal(validatePublishedGameResourceCatalog(catalogEnvelope), catalogEnvelope);
  const invalidSchemaCatalog = structuredClone(catalogEnvelope);
  invalidSchemaCatalog.payload.modules[0].resources[0].payloadSchemaVersion = 0;
  assert.throws(
    () => validatePublishedGameResourceCatalog(invalidSchemaCatalog),
    /payload schema version/,
  );
  assert.equal(
    verify(
      null,
      canonicalResourceMessage({ ...signed, payload }),
      publicKey,
      Buffer.from(signed.signature, 'base64url'),
    ),
    true,
  );
  assert.equal(
    verify(
      null,
      canonicalResourceMessage({ ...signed, payload: Buffer.from('modified') }),
      publicKey,
      Buffer.from(signed.signature, 'base64url'),
    ),
    false,
  );
});

test('resource signer rejects cross-module IDs, invalid versions and wrong key types', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const input = {
    moduleId: 'game.archery',
    resourceId: 'game.archery.rules',
    version: '1.0.0',
    payload: Buffer.from('rules'),
    privateKeyPem,
    signingKeyId: 'test-key',
    contentType: 'application/octet-stream',
    baseUrl: 'https://assets.example.test',
  };
  assert.throws(() => signGameResource({ ...input, resourceId: 'game.royale.rules' }), /owned/);
  assert.throws(() => signGameResource({ ...input, version: 'latest' }), /semantic versioning/);
  assert.throws(() => signGameResource({ ...input, payloadSchemaVersion: 0 }), /positive integer/);
  assert.throws(() => signGameResource({ ...input, baseUrl: 'http://assets.example.test' }), /HTTPS/);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => signGameResource({ ...input, privateKeyPem: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
    /Ed25519/,
  );
});

test('resource signer emits installer, catalog and KV publication metadata', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const result = signGameResource({
    moduleId: 'game.archery',
    resourceId: 'game.archery.rules',
    version: '1.0.0',
    payload: Buffer.from('rules'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signingKeyId: 'resource-release-2026-01',
    contentType: 'application/json',
    baseUrl: 'https://assets.example.test',
  });
  assert.equal(result.storageMetadata.contentType, 'application/json');
  assert.equal(result.downloadUrl.startsWith('https://'), true);
  assert.equal(result.signature.length, 86);
});

test('resource CLI signs the exact file bytes and emits consumable metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'game-resource-sign-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const payload = Buffer.from([0, 1, 2, 255]);
    const payloadPath = join(directory, 'rules.bin');
    const keyPath = join(directory, 'resource-private.pem');
    await writeFile(payloadPath, payload);
    await writeFile(keyPath, privateKeyPem, { mode: 0o600 });
    const scriptPath = fileURLToPath(new URL('../scripts/sign-game-resource.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--file', payloadPath,
      '--private-key', keyPath,
      '--module-id', 'game.archery',
      '--resource-id', 'game.archery.rules',
      '--version', '1.0.0',
      '--key-id', 'resource-cli-test',
      '--content-type', 'application/octet-stream',
      '--base-url', 'https://assets.example.test',
      '--payload-schema-version', '1',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(privateKeyPem), false);
    const signed = JSON.parse(result.stdout);
    assert.equal(signed.byteLength, payload.byteLength);
    assert.equal(signed.payloadSchemaVersion, 1);
    assert.equal(signed.storageMetadata.byteLength, payload.byteLength);
    assert.equal(signed.downloadUrl, 'https://assets.example.test/game-resources/archery/game.archery.rules/1.0.0');
    assert.equal(signed.contentKey, 'game-resource:archery:game.archery.rules:1.0.0');
    assert.equal(
      verify(
        null,
        canonicalResourceMessage({ ...signed, payload }),
        publicKey,
        Buffer.from(signed.signature, 'base64url'),
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
