import assert from 'node:assert/strict';
import test from 'node:test';

import { handleDynamicChatRoutes, matchChatDmRoute } from '../src/api/chat_api.js';

test('snapshot v2 remains retryable until the client acknowledges local import', async () => {
  const env = testEnv();
  const payload = { chat_1_2: { '2026-01-01T00:00:00.000Z_1': '{"text":"hi"}' } };
  const uploaded = await route(env, 'POST', '/api/chat/dm/2/sync-upload', payload);
  assert.equal(uploaded.status, 200);

  const first = await route(env, 'GET', '/api/chat/dm/2/sync-download-v2');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), payload);
  const snapshotId = first.headers.get('X-Chat-Snapshot-Id');
  assert.match(snapshotId, /^[0-9a-f-]{36}$/i);
  assert.equal(env.CHAT_SYNC.values.has('chat_sync:1:2'), true);

  const retry = await route(env, 'GET', '/api/chat/dm/2/sync-download-v2');
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get('X-Chat-Snapshot-Id'), snapshotId);

  const acknowledged = await route(
    env,
    'POST',
    '/api/chat/dm/2/sync-ack',
    { snapshotId },
  );
  assert.equal(acknowledged.status, 200);
  const consumed = await route(env, 'GET', '/api/chat/dm/2/sync-download-v2');
  assert.equal(consumed.status, 404);
  assert.equal(env.CHAT_SYNC.values.has('chat_sync:1:2'), true);
  const legacyConsumed = await route(env, 'GET', '/api/chat/dm/2/sync-download');
  assert.equal(legacyConsumed.status, 404);
  assert.equal(env.CHAT_SYNC.values.has('chat_sync:1:2'), false);
});

test('an acknowledgement for an older upload cannot consume the newer snapshot', async () => {
  const env = testEnv();
  await route(env, 'POST', '/api/chat/dm/2/sync-upload', { chat_1_2: { a: 'one' } });
  const older = await route(env, 'GET', '/api/chat/dm/2/sync-download-v2');
  const olderId = older.headers.get('X-Chat-Snapshot-Id');

  await route(env, 'POST', '/api/chat/dm/2/sync-upload', { chat_1_2: { b: 'two' } });
  const staleAck = await route(env, 'POST', '/api/chat/dm/2/sync-ack', { snapshotId: olderId });
  assert.equal(staleAck.status, 409);

  const current = await route(env, 'GET', '/api/chat/dm/2/sync-download-v2');
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), { chat_1_2: { b: 'two' } });
});

test('legacy one-shot download keeps its original behavior and payload shape', async () => {
  const env = testEnv();
  const payload = { chat_1_2: { a: 'legacy' } };
  await route(env, 'POST', '/api/chat/dm/2/sync-upload', payload);

  const first = await route(env, 'GET', '/api/chat/dm/2/sync-download');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), payload);
  assert.equal(env.CHAT_SYNC.values.has('chat_sync:1:2'), false);
  assert.equal((await route(env, 'GET', '/api/chat/dm/2/sync-download')).status, 404);
});

test('chat sync routes expose the retry-safe download and acknowledgement actions', () => {
  assert.deepEqual(
    matchChatDmRoute('/api/chat/dm/2/sync-download-v2'),
    { friendId: 2, action: 'sync-download-v2' },
  );
  assert.deepEqual(
    matchChatDmRoute('/api/chat/dm/2/sync-ack'),
    { friendId: 2, action: 'sync-ack' },
  );
});

async function route(env, method, pathname, body) {
  const request = new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      Authorization: 'Bearer session-1',
      Origin: 'https://example.test',
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return handleDynamicChatRoutes(request, env, new URL(request.url), {});
}

function testEnv() {
  const chatSync = new MemoryKv();
  return {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes('FROM sessions')) {
              return { user_id: 1, expires_at: '2999-01-01T00:00:00.000Z' };
            }
            if (sql.includes('FROM users')) {
              return { id: 1, role: 'user' };
            }
            return null;
          },
          async run() {
            return { success: true };
          },
        };
      },
    },
    CHAT_SYNC: chatSync,
  };
}

class MemoryKv {
  values = new Map();

  async get(key) {
    return this.values.get(key)?.value ?? null;
  }

  async getWithMetadata(key) {
    const value = this.values.get(key);
    return { value: value?.value ?? null, metadata: value?.metadata ?? null };
  }

  async put(key, value, options = {}) {
    this.values.set(key, { value: String(value), metadata: options.metadata ?? null });
  }

  async delete(key) {
    this.values.delete(key);
  }
}
