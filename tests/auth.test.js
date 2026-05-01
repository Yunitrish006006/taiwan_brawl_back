import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetGoogleJwkCacheForTests,
  verifyGoogleIdToken,
  handleGoogleLogin,
  handleMe,
  handleLogout,
} from '../src/core/auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

// Helper to create mock requests
function createMockRequest(headers = {}, method = 'POST', url = 'https://example.com') {
  return new Request(url, { method, headers });
}

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
    iat: nowSeconds,
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

// ── verifyGoogleIdToken tests ──────────────────────────────────────────────────

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

test('verifyGoogleIdToken rejects expired tokens', async () => {
  __resetGoogleJwkCacheForTests();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const { jwk, token } = await signedGoogleToken({
    exp: nowSeconds - 60, // Expired 60 seconds ago
    iat: nowSeconds - 120
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

test('verifyGoogleIdToken rejects tokens without sub claim', async () => {
  __resetGoogleJwkCacheForTests();
  const { jwk, token } = await signedGoogleToken({
    sub: undefined
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

test('verifyGoogleIdToken rejects tokens for wrong issuer', async () => {
  __resetGoogleJwkCacheForTests();
  const { jwk, token } = await signedGoogleToken({
    iss: 'https://evil.com'
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

// ── handleGoogleLogin tests ──────────────────────────────────────────────────

test('handleGoogleLogin returns 400 for missing token', async () => {
  __resetGoogleJwkCacheForTests();
  const request = createMockRequest({
    'Content-Type': 'application/json',
    Origin: 'https://taiwan-brawl-api.yunitrish0419.workers.dev',
  });

  const response = await handleGoogleLogin(request, {});
  assert.equal(response.status, 400);
});

test('handleGoogleLogin returns 400 for empty body', async () => {
  __resetGoogleJwkCacheForTests();
  const request = new Request('https://example.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const response = await handleGoogleLogin(request, {});
  assert.equal(response.status, 400);
});

test('handleGoogleLogin handles invalid JSON', async () => {
  __resetGoogleJwkCacheForTests();
  const request = new Request('https://example.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-valid-json',
  });

  const response = await handleGoogleLogin(request, {});
  assert.equal(response.status, 400);
});

// ── handleMe tests ───────────────────────────────────────────────────────────

test('handleMe returns 401 without session', async () => {
  __resetGoogleJwkCacheForTests();
  const request = createMockRequest({
    Origin: 'https://taiwan-brawl-api.yunitrish0419.workers.dev',
  });

  const response = await handleMe(request, { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } });
  assert.equal(response.status, 401);
});

test('handleMe returns 401 with invalid session cookie', async () => {
  __resetGoogleJwkCacheForTests();
  const request = createMockRequest({
    Cookie: 'session_id=invalid-session-id',
    Origin: 'https://taiwan-brawl-api.yunitrish0419.workers.dev',
  });

  const response = await handleMe(request, { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } });
  assert.equal(response.status, 401);
});

// ── handleLogout tests ────────────────────────────────────────────────────────

test('handleLogout handles missing session gracefully (idempotent)', async () => {
  __resetGoogleJwkCacheForTests();
  const request = createMockRequest({
    Origin: 'https://taiwan-brawl-api.yunitrish0419.workers.dev',
  });

  // Logout is idempotent - returns 200 even without session
  const response = await handleLogout(request, { DB: { prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }) } });
  assert.equal(response.status, 200, 'Logout should be idempotent');
});

test('handleLogout returns 200 with valid session', async () => {
  __resetGoogleJwkCacheForTests();
  const request = createMockRequest({
    Cookie: 'session_id=valid-session-id',
    Origin: 'https://taiwan-brawl-api.yunitrish0419.workers.dev',
  });

  const mockDb = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ user_id: 1, expires_at: new Date(Date.now() + 86400000).toISOString() }),
        run: async () => ({ meta: {} })
      })
    })
  };

  const response = await handleLogout(request, { DB: mockDb });
  assert.equal(response.status, 200);
});

// ── __resetGoogleJwkCacheForTests ────────────────────────────────────────────

test('__resetGoogleJwkCacheForTests exists and is callable', () => {
  assert.equal(typeof __resetGoogleJwkCacheForTests, 'function');
  assert.doesNotThrow(() => __resetGoogleJwkCacheForTests());
});

// ── Error handling tests ─────────────────────────────────────────────────────

test('handleGoogleLogin handles DB errors gracefully', async () => {
  __resetGoogleJwkCacheForTests();
  const request = new Request('https://example.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fake-token' }),
  });

  const badEnv = {
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error('DB Error'); } }) }),
    },
  };

  const response = await handleGoogleLogin(request, badEnv);
  // Should return error response, not crash
  assert.ok(response.status >= 400, 'Should return error response');
});

test('handleMe handles expired session', async () => {
  __resetGoogleJwkCacheForTests();
  const request = createMockRequest({
    Cookie: 'session_id=expired-session',
    Origin: 'https://taiwan-brawl-api.yunitrish0419.workers.dev',
  });

  const mockDb = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ user_id: 1, expires_at: new Date(Date.now() - 86400000).toISOString() })
      })
    })
  };

  const response = await handleMe(request, { DB: mockDb });
  assert.equal(response.status, 401);
});
