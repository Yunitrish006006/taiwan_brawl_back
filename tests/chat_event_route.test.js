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

  const pending = await route(env, 'GET', '/api/chat/dm/pending');
  assert.equal(pending.status, 200);
  const payload = await pending.json();
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].event_id, 'event-1');

  const ack = await route(env, 'POST', '/api/chat/dm/ack', { ids: [1, 2] });
  assert.equal(ack.status, 200);
  assert.deepEqual(db.pending.map((row) => row.id), [2]);
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

  const response = await route(
    testEnv(db),
    'GET',
    '/api/chat/dm/pending?friendId=2&afterId=1',
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.messages.map((row) => row.id), [3]);
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
    this.nextPendingId = 1;
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
      return { user_id: 1, expires_at: '2099-01-01T00:00:00.000Z' };
    }
    if (this.sql.includes('FROM friendships')) {
      return this.args[0] === 1 && this.args[1] === 2 ? { 1: 1 } : null;
    }
    if (this.sql.includes('FROM users')) {
      return { id: this.args[0], name: 'Alice', role: 'user' };
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
    if (this.sql.startsWith('DELETE FROM pending_messages')) {
      const receiverId = this.args[0];
      const ids = new Set(this.args.slice(1));
      const before = this.db.pending.length;
      this.db.pending = this.db.pending.filter(
        (row) => row.receiver_id !== receiverId || !ids.has(row.id),
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
    return this.db.pending.filter(
      (row) =>
        row.receiver_id === receiverId &&
        (friendId == null || row.sender_id === friendId) &&
        (afterId == null || row.id > afterId),
    );
  }
}
