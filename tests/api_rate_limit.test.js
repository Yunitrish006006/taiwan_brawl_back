import assert from 'node:assert/strict';
import test from 'node:test';

import { handleApiRequest } from '../src/api/api_router.js';
import { checkRateLimit } from '../src/core/rate_limit.js';

test('rate-limited API requests return 429 instead of an empty Worker response', async () => {
  const request = new Request('https://api.example.test/api/health', {
    headers: {
      Origin: 'https://api.example.test',
      'CF-Connecting-IP': '192.0.2.10',
    },
  });
  const env = {
    CHAT_SYNC: {
      async get() {
        return '100';
      },
      async put() {
        assert.fail('A rejected request must not increment its counter');
      },
    },
  };

  const response = await handleApiRequest(request, env, new URL(request.url));

  assert.ok(response instanceof Response);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After') !== null, true);
  assert.equal(response.headers.get('X-RateLimit-Remaining'), '0');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://api.example.test');
  assert.match((await response.json()).error, /Too Many Requests/);
});

test('DM polling has a scoped budget so it does not exhaust the general API quota', async () => {
  const keys = [];
  const env = {
    CHAT_SYNC: {
      async get(key) {
        keys.push(key);
        return '100';
      },
      async put() {},
    },
  };
  const pendingRequest = new Request(
    'https://api.example.test/api/chat/dm/pending?friendId=2',
  );
  const generalRequest = new Request('https://api.example.test/api/friends/overview');

  const pending = await checkRateLimit(
    pendingRequest,
    env,
    new URL(pendingRequest.url),
  );
  const general = await checkRateLimit(
    generalRequest,
    env,
    new URL(generalRequest.url),
  );

  assert.equal(pending.allowed, true);
  assert.equal(pending.limit, 600);
  assert.equal(general.allowed, false);
  assert.notEqual(keys[0], keys[1]);
});
