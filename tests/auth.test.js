import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetGoogleJwkCacheForTests,
  verifyGoogleIdToken
} from '../src/auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function base64UrlEncodeBytes(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

async function signedGoogleToken(payloadOverrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const jwk = {
    ...publicJwk,
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig'
  };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: jwk.kid
  };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: nowSeconds + 60,
    sub: 'google-sub-1',
    email: 'user@example.com',
    email_verified: true,
    name: 'Test User',
    picture: 'https://example.com/avatar.png',
    ...payloadOverrides
  };
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );

  return {
    jwk,
    token: `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`
  };
}

function jwkFetcher(jwk) {
  return async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { 'Cache-Control': 'public, max-age=3600' }
    });
}

test('verifyGoogleIdToken verifies signature and required claims', async () => {
  __resetGoogleJwkCacheForTests();
  const { jwk, token } = await signedGoogleToken();

  const user = await verifyGoogleIdToken(
    token,
    {},
    {
      clientIds: [CLIENT_ID],
      fetcher: jwkFetcher(jwk)
    }
  );

  assert.deepEqual(user, {
    sub: 'google-sub-1',
    email: 'user@example.com',
    name: 'Test User',
    picture: 'https://example.com/avatar.png'
  });
});

test('verifyGoogleIdToken rejects tokens for another audience', async () => {
  __resetGoogleJwkCacheForTests();
  const { jwk, token } = await signedGoogleToken({
    aud: 'other-client.apps.googleusercontent.com'
  });

  const user = await verifyGoogleIdToken(
    token,
    {},
    {
      clientIds: [CLIENT_ID],
      fetcher: jwkFetcher(jwk)
    }
  );

  assert.equal(user, null);
});
