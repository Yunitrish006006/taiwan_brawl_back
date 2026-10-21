import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  canonicalCatalogMessage,
  canonicalCatalogJson,
  signGameCatalog,
} from '../scripts/sign-game-catalog.mjs';

const payload = {
  modules: [{
    resources: [],
    platforms: ['web', 'android'],
    dataSchemaVersion: 1,
    dependencies: [],
    hostApiRange: '>=1.0.0 <2.0.0',
    minimumShellVersion: '0.132.0',
    packageVersion: '0.1.0',
    publisher: 'taiwan-brawl',
    description: 'First-party Archery game',
    displayName: 'Archery',
    kind: 'game',
    manifestVersion: 1,
    moduleId: 'game.archery',
  }],
  catalogVersion: 1,
};

test('canonical JSON recursively sorts object keys but preserves array order', () => {
  assert.equal(
    canonicalCatalogJson({ z: [{ b: 2, a: 1 }], a: true }),
    '{"a":true,"z":[{"a":1,"b":2}]}',
  );
  assert.throws(() => canonicalCatalogJson({ invalid: Number.NaN }), /finite/);
});

test('signer creates a backend-valid envelope verifiable with Ed25519 public key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const now = new Date(Date.now() - 60_000);
  const envelope = signGameCatalog({
    payload,
    publisher: 'taiwan-brawl',
    signingKeyId: 'catalog-release-2026-01',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    now,
  });
  assert.equal(envelope.envelopeVersion, 1);
  assert.equal(envelope.expiresAt, new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());
  assert.equal(
    verify(
      null,
      canonicalCatalogMessage({
        publisher: envelope.publisher,
        signingKeyId: envelope.signingKeyId,
        issuedAt: envelope.issuedAt,
        expiresAt: envelope.expiresAt,
        payload: envelope.payload,
      }),
      publicKey,
      Buffer.from(envelope.signature, 'base64url'),
    ),
    true,
  );
  const tamperedPayload = structuredClone(envelope.payload);
  tamperedPayload.modules[0].displayName = 'Tampered';
  assert.equal(
    verify(
      null,
      canonicalCatalogMessage({
        publisher: envelope.publisher,
        signingKeyId: envelope.signingKeyId,
        issuedAt: envelope.issuedAt,
        expiresAt: envelope.expiresAt,
        payload: tamperedPayload,
      }),
      publicKey,
      Buffer.from(envelope.signature, 'base64url'),
    ),
    false,
  );
});

test('signer rejects invalid expiry, non-Ed25519 keys and invalid catalog data', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const sign = (overrides = {}) => signGameCatalog({
    payload,
    publisher: 'taiwan-brawl',
    signingKeyId: 'catalog-release-2026-01',
    privateKeyPem,
    now: new Date(Date.now() - 60_000),
    ...overrides,
  });
  assert.throws(() => sign({ expiresInHours: 0 }), /expiry/);
  assert.throws(() => sign({ payload: { catalogVersion: 2, modules: [] } }), /Unsupported catalog shape/);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => sign({ privateKeyPem: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
    /Ed25519/,
  );
});

test('CLI reads protected key material and emits only the validated envelope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'game-catalog-sign-'));
  try {
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const inputPath = join(directory, 'catalog.json');
    const keyPath = join(directory, 'catalog-private.pem');
    await writeFile(inputPath, JSON.stringify(payload));
    await writeFile(keyPath, privateKeyPem, { mode: 0o600 });
    const scriptPath = fileURLToPath(new URL('../scripts/sign-game-catalog.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--input', inputPath,
      '--private-key', keyPath,
      '--publisher', 'taiwan-brawl',
      '--key-id', 'catalog-cli-test',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(privateKeyPem), false);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.publisher, 'taiwan-brawl');
    assert.equal(envelope.signingKeyId, 'catalog-cli-test');
    assert.equal(envelope.signature.length, 86);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
