import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  readCatalogTrustRoot,
  verifyCatalogKeyPair,
} from '../scripts/verify-keychain-catalog-key.mjs';

function makePair() {
  const pair = generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    privatePem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKey: publicDer.subarray(-32).toString('base64url'),
  };
}

test('Keychain verification accepts a matching Ed25519 pair without exporting the key', () => {
  const pair = makePair();
  assert.equal(verifyCatalogKeyPair(pair.privatePem, pair.publicKey), true);
});

test('Keychain verification rejects a mismatched public key', () => {
  const privatePair = makePair();
  const otherPair = makePair();
  assert.throws(
    () => verifyCatalogKeyPair(privatePair.privatePem, otherPair.publicKey),
    /does not match/,
  );
});

test('verification reads the production trust root from the Worker config', () => {
  const config = JSON.stringify({ vars: { GAME_CATALOG_TRUST_KEYS: JSON.stringify({
    'catalog-prod-2026-10': {
      publisher: 'taiwan-brawl',
      publicKey: '4WyFxNR343aaKu1ccZNpBGg4OQ2D3qH7ekYMAJzFQ1c',
    },
  }) } });
  assert.deepEqual(readCatalogTrustRoot(config), {
    publisher: 'taiwan-brawl',
    publicKey: '4WyFxNR343aaKu1ccZNpBGg4OQ2D3qH7ekYMAJzFQ1c',
  });
});
