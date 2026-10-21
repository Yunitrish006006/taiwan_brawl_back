import test from 'node:test';
import assert from 'node:assert/strict';
import { exactMiniRoyaleDataApiRouteHandler } from '../src/api/mini_royale_data_api.js';
import {
  exactMiniRoyaleRoomApiRouteHandler,
  handleDynamicMiniRoyaleRoomRoutes
} from '../src/api/mini_royale_room_api.js';
import { handleDynamicRoomRoutes } from '../src/api/rooms_api.js';

test('Mini Royale data API owns versioned and legacy data routes', () => {
  const cases = [
    ['GET', '/api/games/mini-royale/v1/cards'],
    ['GET', '/api/games/mini-royale/v1/heroes'],
    ['GET', '/api/games/mini-royale/v1/progression'],
    ['GET', '/api/games/mini-royale/v1/decks'],
    ['POST', '/api/games/mini-royale/v1/decks'],
    ['POST', '/api/games/mini-royale/v1/decks/hero'],
    ['GET', '/api/cards'],
    ['GET', '/api/heroes'],
    ['GET', '/api/progression'],
    ['GET', '/api/decks'],
    ['POST', '/api/decks'],
    ['POST', '/api/decks/hero'],
  ];

  for (const [method, pathname] of cases) {
    const request = new Request(`https://api.test${pathname}`, { method });
    assert.equal(
      typeof exactMiniRoyaleDataApiRouteHandler(
        request,
        {},
        new URL(request.url),
      ),
      'function',
      `${method} ${pathname} should resolve to the game-owned API`,
    );
  }
});

test('Mini Royale room API owns create and multiplayer route admission', async () => {
  for (const pathname of [
    '/api/games/mini-royale/v1/rooms',
    '/api/rooms',
  ]) {
    const request = new Request(`https://api.test${pathname}`, {
      method: 'POST',
    });
    assert.equal(
      typeof exactMiniRoyaleRoomApiRouteHandler(
        request,
        {},
        new URL(request.url),
      ),
      'function',
    );
  }

  const joinRequest = new Request(
    'https://api.test/api/games/mini-royale/v1/rooms/ROOM42/join',
    { method: 'POST', body: '{}' },
  );
  const response = await handleDynamicMiniRoyaleRoomRoutes(
    joinRequest,
    {},
    new URL(joinRequest.url),
  );
  assert.equal(response.status, 401);
});

test('public Mini Royale room creation rejects missing or malformed client contracts before room lookup', async () => {
  const now = Date.now();
  let deckLookupCount = 0;
  let roomLookupCount = 0;
  const env = {
    CHAT_SYNC: {
      async get() { return String(now); },
    },
    DB: {
      prepare(query) {
        if (query.includes('SELECT user_id, expires_at FROM sessions')) {
          return { bind: () => ({ async first() {
            return { user_id: 7, expires_at: new Date(now + 60_000).toISOString() };
          } }) };
        }
        if (query.includes('FROM users')) {
          return { bind: () => ({ async first() {
            return { id: 7, name: 'Player', email: 'player@example.test', role: 'user' };
          } }) };
        }
        if (query.includes('FROM decks')) deckLookupCount++;
        throw new Error(`Unexpected SQL in invalid-contract test: ${query}`);
      },
    },
    ROYALE_ROOM: {
      idFromName() {
        roomLookupCount++;
        return { toString: () => 'unused-room-id' };
      },
      get() { throw new Error('Room namespace must not be accessed.'); },
    },
  };

  for (const gameContract of [undefined, { gameId: 'game.mini-royale' }]) {
    const request = new Request('https://api.test/api/games/mini-royale/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session_id=valid-session',
      },
      body: JSON.stringify({ deckId: 1, ...(gameContract ? { gameContract } : {}) }),
    });
    const handler = exactMiniRoyaleRoomApiRouteHandler(request, env, new URL(request.url));
    const response = await handler(env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_GAME_CONTRACT');
  }

  assert.equal(deckLookupCount, 0);
  assert.equal(roomLookupCount, 0);
});

test('Mini Royale data API does not claim room proxy or unrelated game routes', () => {
  for (const pathname of [
    '/api/games/mini-royale/v1/rooms/ABCD/state',
    '/api/games/archery/v1/cards',
    '/api/games/mini-royale/v2/cards',
  ]) {
    const request = new Request(`https://api.test${pathname}`);
    assert.equal(
      exactMiniRoyaleDataApiRouteHandler(request, {}, new URL(request.url)),
      null,
    );
  }
});

test('shared room facade keeps legacy and versioned social invite dispatch', async () => {
  for (const pathname of [
    '/api/rooms/ROOM42/invite',
    '/api/games/mini-royale/v1/rooms/ROOM42/invite',
  ]) {
    const request = new Request(`https://api.test${pathname}`, {
      method: 'POST',
      body: '{}',
    });
    const response = await handleDynamicRoomRoutes(
      request,
      {},
      new URL(request.url),
    );
    assert.equal(response.status, 401);
  }
  const unsupportedGameRequest = new Request(
    'https://api.test/api/games/archery/v1/rooms/ROOM42/invite',
    { method: 'POST', body: '{}' },
  );
  assert.equal(
    await handleDynamicRoomRoutes(
      unsupportedGameRequest,
      {},
      new URL(unsupportedGameRequest.url),
    ),
    null,
  );
});
