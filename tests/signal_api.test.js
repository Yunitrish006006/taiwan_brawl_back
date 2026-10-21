import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleDynamicSignalRoutes,
  matchSignalRoute,
} from '../src/api/signal_api.js';

test('signal route matcher accepts only numeric peer ids', () => {
  assert.deepEqual(matchSignalRoute('/api/chat/signal/42'), { friendId: 42 });
  assert.equal(matchSignalRoute('/api/chat/signal/not-a-user'), null);
  assert.equal(matchSignalRoute('/api/chat/signal/42/extra'), null);
});

test('authenticated friends are forwarded to the transient signal room', async () => {
  let forwardedRequest;
  const env = {
    DB: new FakeD1(),
    CHAT_SYNC: { get: async () => '0', put: async () => {} },
    SIGNAL_ROOM: {
      idFromName(name) {
        assert.equal(name, 'signal:1:2');
        return 'signal-room-id';
      },
      get(id) {
        assert.equal(id, 'signal-room-id');
        return {
          async fetch(request) {
            forwardedRequest = request;
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  const request = new Request('https://example.test/api/chat/signal/2', {
    headers: {
      Authorization: 'Bearer session-1',
      Origin: 'https://example.test',
      Upgrade: 'websocket',
    },
  });

  const response = await handleDynamicSignalRoutes(
    request,
    env,
    new URL(request.url),
  );

  assert.equal(response.status, 200);
  assert.equal(forwardedRequest.url, 'https://signal-room/internal/signal');
  assert.equal(forwardedRequest.headers.get('x-user-id'), '1');
});

test('signal route rejects unauthenticated requests before room access', async () => {
  const env = {
    DB: new FakeD1(),
    SIGNAL_ROOM: {
      idFromName() {
        throw new Error('room must not be accessed');
      },
    },
  };
  const request = new Request('https://example.test/api/chat/signal/2', {
    headers: { Origin: 'https://example.test', Upgrade: 'websocket' },
  });

  const response = await handleDynamicSignalRoutes(
    request,
    env,
    new URL(request.url),
  );

  assert.equal(response.status, 401);
});

class FakeD1 {
  prepare(sql) {
    return new FakeStatement(sql);
  }
}

class FakeStatement {
  constructor(sql) {
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql.includes('FROM sessions')) {
      return this.args[0] === 'session-1'
        ? { user_id: 1, expires_at: '2099-01-01T00:00:00.000Z' }
        : null;
    }
    if (this.sql.includes('FROM friendships')) {
      return this.args[0] === 1 && this.args[1] === 2 ? { ok: 1 } : null;
    }
    if (this.sql.includes('FROM users')) {
      return { id: this.args[0], role: 'player' };
    }
    return null;
  }

  async run() {
    return { meta: { changes: 1 } };
  }
}
