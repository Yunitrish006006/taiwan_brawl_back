import assert from 'node:assert/strict';
import test from 'node:test';

import { handleDynamicChatRoutes } from '../src/api/chat_api.js';

test('event route inserts, replays idempotently, and rejects collisions', async () => {
  const db = new FakeD1();
  const env = testEnv(db);
  const event = {
    eventId: 'event-1',
    messageId: 'message-1',
    conversationId: '1:2',
    actorId: 'ignored-by-server',
    type: 'created',
    revision: 0,
    createdAt: '2026-10-20T00:00:00.000Z',
    body: 'hello',
    signature: null,
  };

  const first = await route(
    env,
    'POST',
    '/api/chat/dm/2/event',
    { event },
  );
  assert.equal(first.status, 201);
  assert.equal(db.pending.length, 1);
  assert.equal(db.pending[0].sender_id, 1);

  const replay = await route(
    env,
    'POST',
    '/api/chat/dm/2/event',
    { event },
  );
  assert.equal(replay.status, 200);
  assert.equal(db.pending.length, 1);

  const collision = await route(
    env,
    'POST',
    '/api/chat/dm/2/event',
    { event: { ...event, body: 'tampered' } },
  );
  assert.equal(collision.status, 409);
  assert.equal(db.pending.length, 1);
});

test('pending route returns event metadata and ack removes only the receiver rows', async () => {
  const db = new FakeD1();
  db.pending.push({
    id: 1,
    sender_id: 2,
    receiver_id: 1,
    text: 'hello',
    created_at: '2026-10-20T00:00:00.000Z',
    type: 'message',
    event_id: 'event-1',
    message_id: 'message-1',
    revision: 0,
    event_type: 'created',
    signature: null,
  });
  db.pending.push({
    id: 2,
    sender_id: 1,
    receiver_id: 2,
    text: 'other',
    created_at: '2026-10-20T00:01:00.000Z',
    type: 'message',
    event_id: 'event-2',
    message_id: 'message-2',
    revision: 0,
    event_type: 'created',
    signature: null,
  });
  const env = testEnv(db);
  await registerDevice(env, 'device-a');

  const pending = await route(env, 'GET', '/api/chat/dm/pending?deviceId=device-a');
  assert.equal(pending.status, 200);
  const payload = await pending.json();
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].event_id, 'event-1');

  const ack = await route(env, 'POST', '/api/chat/dm/ack', { ids: [1, 2], deviceId: 'device-a' });
  assert.equal(ack.status, 200);
  assert.deepEqual(db.pending.map((row) => row.id), [2]);
});

test('relay retains a row until every active device acknowledges it', async () => {
  const db = new FakeD1();
  db.pending.push({ id: 1, sender_id: 2, receiver_id: 1, text: 'hello', created_at: '2026-10-20T00:00:00.000Z', type: 'message' });
  const env = testEnv(db);
  await registerDevice(env, 'phone');
  await registerDevice(env, 'tablet');
  for (const deviceId of ['phone', 'tablet']) {
    const pending = await route(env, 'GET', `/api/chat/dm/pending?deviceId=${deviceId}`);
    assert.equal((await pending.json()).messages.length, 1);
  }
  const phoneAck = await route(env, 'POST', '/api/chat/dm/ack', { ids: [1], deviceId: 'phone' });
  assert.equal((await phoneAck.json()).deleted, 0);
  assert.equal(db.pending.length, 1);
  const tabletAck = await route(env, 'POST', '/api/chat/dm/ack', { ids: [1], deviceId: 'tablet' });
  assert.equal((await tabletAck.json()).deleted, 1);
  assert.equal(db.pending.length, 0);
});

test('revoked devices stop blocking pending rows and cannot silently re-register', async () => {
  const db = new FakeD1();
  db.pending.push({ id: 1, sender_id: 2, receiver_id: 1, text: 'hello', created_at: '2026-10-20T00:00:00.000Z', type: 'message' });
  const env = testEnv(db);
  await registerDevice(env, 'phone');
  await registerDevice(env, 'lost-tablet');
  const ack = await route(env, 'POST', '/api/chat/dm/ack', { ids: [1], deviceId: 'phone' });
  assert.equal((await ack.json()).deleted, 0);
  const revoke = await route(env, 'POST', '/api/chat/dm/device-revoke', { deviceId: 'lost-tablet' });
  assert.equal(revoke.status, 200);
  assert.equal(db.pending.length, 0);
  const reRegister = await route(env, 'POST', '/api/chat/dm/device-register', { deviceId: 'lost-tablet' });
  assert.equal(reRegister.status, 403);
});

test('device list is scoped to the authenticated account and includes active devices only', async () => {
  const db = new FakeD1();
  const env = testEnv(db);
  await registerDevice(env, 'phone');
  await registerDevice(env, 'tablet');
  await route(env, 'POST', '/api/chat/dm/device-revoke', { deviceId: 'tablet' });
  db.devices.push({ user_id: 2, device_id: 'other-account-device', is_active: 1, created_at: 't', last_seen_at: 't' });

  const response = await route(env, 'GET', '/api/chat/dm/devices');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.devices.map((device) => device.device_id), ['phone']);
});

test('edited and recalled events survive receiver polling until they are acknowledged', async () => {
  const db = new FakeD1();
  const env = testEnv(db);
  const baseEvent = {
    messageId: 'message-1',
    conversationId: '1:2',
    createdAt: '2026-10-28T00:00:00.000Z',
    signature: null,
  };

  for (const event of [
    {
      ...baseEvent,
      eventId: 'event-edit',
      type: 'edited',
      revision: 1,
      body: 'updated message',
    },
    {
      ...baseEvent,
      eventId: 'event-recall',
      type: 'recalled',
      revision: 2,
      body: null,
    },
  ]) {
    const response = await route(env, 'POST', '/api/chat/dm/2/event', { event });
    assert.equal(response.status, 201);
  }

  assert.deepEqual(
    db.pending.map(({ type, event_type, message_id, revision, text }) => ({
      type,
      event_type,
      message_id,
      revision,
      text,
    })),
    [
      {
        type: 'edit',
        event_type: 'edited',
        message_id: 'message-1',
        revision: 1,
        text: 'updated message',
      },
      {
        type: 'recall',
        event_type: 'recalled',
        message_id: 'message-1',
        revision: 2,
        text: '',
      },
    ],
  );

  db.userId = 2;
  await registerDevice(env, 'device-b');
  const pending = await route(env, 'GET', '/api/chat/dm/pending?deviceId=device-b');
  assert.equal(pending.status, 200);
  const payload = await pending.json();
  assert.deepEqual(
    payload.messages.map(({ event_id, event_type, message_id, revision, text }) => ({
      event_id,
      event_type,
      message_id,
      revision,
      text,
    })),
    [
      {
        event_id: 'event-edit',
        event_type: 'edited',
        message_id: 'message-1',
        revision: 1,
        text: 'updated message',
      },
      {
        event_id: 'event-recall',
        event_type: 'recalled',
        message_id: 'message-1',
        revision: 2,
        text: '',
      },
    ],
  );

  const ack = await route(env, 'POST', '/api/chat/dm/ack', {
    ids: payload.messages.map((row) => row.id),
    deviceId: 'device-b',
  });
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).deleted, 2);
  assert.equal(db.pending.length, 0);
});

test('cursor-enabled pending route scopes rows to a friend and after id', async () => {
  const db = new FakeD1();
  db.pending.push(
    {
      id: 1,
      sender_id: 2,
      receiver_id: 1,
      text: 'old',
      created_at: '2026-10-20T00:00:00.000Z',
      type: 'message',
    },
    {
      id: 2,
      sender_id: 3,
      receiver_id: 1,
      text: 'other friend',
      created_at: '2026-10-20T00:01:00.000Z',
      type: 'message',
    },
    {
      id: 3,
      sender_id: 2,
      receiver_id: 1,
      text: 'new',
      created_at: '2026-10-20T00:02:00.000Z',
      type: 'message',
    },
  );

  const env = testEnv(db);
  await registerDevice(env, 'device-test');
  const response = await route(
    env,
    'GET',
    '/api/chat/dm/pending?friendId=2&afterId=1&deviceId=device-test',
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.messages.map((row) => row.id), [3]);
});

test('history route forwards the compound page cursor to the conversation room', async () => {
  const db = new FakeD1();
  let forwardedUrl;
  const env = testEnv(db);
  env.CHAT_ROOM = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (request) => {
        forwardedUrl = new URL(request.url);
        return Response.json({ ok: true, messages: [], hasMore: false });
      },
    }),
  };

  const response = await route(
    env,
    'GET',
    '/api/chat/dm/2/history?before=2026-10-28T00%3A00%3A00.000Z&beforeId=71',
  );

  assert.equal(response.status, 200);
  assert.equal(
    forwardedUrl.searchParams.get('before'),
    '2026-10-28T00:00:00.000Z',
  );
  assert.equal(forwardedUrl.searchParams.get('beforeId'), '71');
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
  return handleDynamicChatRoutes(request, env, new URL(request.url), {
    waitUntil(promise) {
      promise.catch(() => {});
    },
  });
}

function testEnv(db) {
  return {
    DB: db,
    CHAT_SYNC: { get: async () => null, put: async () => {} },
  };
}

class FakeD1 {
  constructor() {
    this.pending = [];
    this.devices = [];
    this.acks = [];
    this.nextPendingId = 1;
    this.userId = 1;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql.includes('FROM sessions')) {
      const sessionId = this.args[0];
      if (sessionId !== 'session-1') return null;
      return { user_id: this.db.userId, expires_at: '2099-01-01T00:00:00.000Z' };
    }
    if (this.sql.includes('FROM friendships')) {
      return this.args[0] === 1 && this.args[1] === 2 ? { 1: 1 } : null;
    }
    if (this.sql.includes('FROM users')) {
      return { id: this.args[0], name: 'Alice', role: 'user' };
    }
    if (this.sql.includes('FROM chat_devices')) {
      return this.db.devices.find((device) =>
        device.user_id === this.args[0] && device.device_id === this.args[1] &&
        (!this.sql.includes('is_active = 1') || device.is_active === 1),
      ) ?? null;
    }
    if (this.sql.includes('WHERE event_id')) {
      return this.db.pending.find((row) => row.event_id === this.args[0]) ?? null;
    }
    if (this.sql.includes('COUNT(*)')) {
      return { total: this.filteredPending().length };
    }
    return null;
  }

  async all() {
    if (this.sql.includes('FROM chat_devices')) {
      return {
        results: this.db.devices
          .filter((device) => device.user_id === this.args[0] && device.is_active === 1)
          .sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at)),
      };
    }
    if (this.sql.includes('FROM pending_messages')) {
      return {
        results: this.filteredPending(),
      };
    }
    if (this.sql.includes('FROM push_registrations')) return { results: [] };
    return { results: [] };
  }

  async run() {
    if (this.sql.startsWith('UPDATE users')) return { meta: { changes: 1 } };
    if (this.sql.includes('INSERT INTO pending_messages')) {
      const [sender, receiver, text, createdAt, type, eventId, messageId, revision, eventType, signature, deviceId] = this.args;
      assert.notEqual(deviceId, undefined, 'D1 bindings must not contain undefined values');
      this.db.pending.push({
        id: this.db.nextPendingId++,
        sender_id: sender,
        receiver_id: receiver,
        text,
        created_at: createdAt,
        type,
        event_id: eventId ?? null,
        message_id: messageId ?? null,
        revision: revision ?? null,
        event_type: eventType ?? null,
        signature: signature ?? null,
        device_id: deviceId ?? null,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes('INSERT INTO chat_devices')) {
      const [userId, deviceId, now] = this.args;
      const existing = this.db.devices.find((device) => device.user_id === userId && device.device_id === deviceId);
      if (existing) {
        if (existing.is_active) existing.last_seen_at = now;
      } else {
        this.db.devices.push({ user_id: userId, device_id: deviceId, is_active: 1, created_at: now, last_seen_at: now });
      }
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes('INSERT OR IGNORE INTO chat_pending_message_acks')) {
      const [pendingId, receiverId, deviceId, acknowledgedAt] = this.args;
      if (this.db.pending.some((row) => row.id === pendingId && row.receiver_id === receiverId) &&
          !this.db.acks.some((ack) => ack.pending_id === pendingId && ack.device_id === deviceId)) {
        this.db.acks.push({ pending_id: pendingId, receiver_id: receiverId, device_id: deviceId, acknowledged_at: acknowledgedAt });
      }
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('UPDATE chat_devices')) {
      const [userId, deviceId] = this.args;
      const device = this.db.devices.find((row) => row.user_id === userId && row.device_id === deviceId);
      if (device) device.is_active = 0;
      return { meta: { changes: device ? 1 : 0 } };
    }
    if (this.sql.startsWith('DELETE FROM pending_messages')) {
      const receiverId = this.args[0];
      const ids = this.args.length > 1 ? new Set(this.args.slice(1)) : null;
      const before = this.db.pending.length;
      this.db.pending = this.db.pending.filter(
        (row) => {
          if (row.receiver_id !== receiverId || (ids && !ids.has(row.id))) return true;
          const activeDevices = this.db.devices.filter((device) => device.user_id === receiverId && device.is_active === 1);
          return activeDevices.some((device) => !this.db.acks.some(
            (ack) => ack.pending_id === row.id && ack.receiver_id === receiverId && ack.device_id === device.device_id,
          ));
        },
      );
      return { meta: { changes: before - this.db.pending.length } };
    }
    return { meta: { changes: 0 } };
  }

  filteredPending() {
    const receiverId = this.args[0];
    const friendId = this.sql.includes('sender_id = ?2') ? this.args[1] : null;
    const afterId = this.sql.includes('id > ?')
      ? this.args[friendId == null ? 1 : 2]
      : null;
    const deviceId = this.sql.includes('chat_pending_message_acks a')
      ? this.args[this.args.length - 3]
      : null;
    return this.db.pending.filter(
      (row) =>
        row.receiver_id === receiverId &&
        (friendId == null || row.sender_id === friendId) &&
        (afterId == null || row.id > afterId) &&
        (deviceId == null || !this.db.acks.some((ack) => ack.pending_id === row.id && ack.device_id === deviceId)),
    );
  }
}

async function registerDevice(env, deviceId) {
  const response = await route(env, 'POST', '/api/chat/dm/device-register', { deviceId });
  assert.equal(response.status, 200);
}
