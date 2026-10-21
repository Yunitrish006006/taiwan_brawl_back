import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapMiniRoyaleApiPath,
  resolveGameApiPath,
} from '../src/api/game_api_paths.js';
import { handleApiRequest } from '../src/api/api_router.js';
import { exactRoomsApiRouteHandler } from '../src/api/rooms_api.js';

test('versioned Mini Royale routes map to their existing migration handlers', () => {
  assert.equal(mapMiniRoyaleApiPath('/api/games/mini-royale/v1/cards'), '/api/cards');
  assert.equal(mapMiniRoyaleApiPath('/api/games/mini-royale/v1/decks/hero'), '/api/decks/hero');
  assert.equal(mapMiniRoyaleApiPath('/api/games/mini-royale/v1/rooms/ABCD/join'), '/api/rooms/ABCD/join');
  assert.equal(mapMiniRoyaleApiPath('/api/games/mini-royale/v1/unknown'), null);
  assert.equal(mapMiniRoyaleApiPath('/api/games/archery/v1/cards'), null);
  assert.deepEqual(
    resolveGameApiPath('/api/games/mini-royale/v1/rooms/ABCD/invite'),
    {
      gameId: 'game.mini-royale',
      pathname: '/api/rooms/ABCD/invite',
    },
  );
  assert.equal(resolveGameApiPath('/api/games/archery/v1/rooms/ABCD/invite'), null);
});

test('the backend game API owner accepts versioned paths and keeps legacy aliases', () => {
  for (const path of ['/api/games/mini-royale/v1/cards', '/api/cards']) {
    const handler = exactRoomsApiRouteHandler(
      new Request(`https://api.test${path}`),
      {},
      new URL(`https://api.test${path}`),
    );
    assert.equal(typeof handler, 'function');
  }
});

test('the integrated router returns 404 for unowned and unsupported game paths', async () => {
  let roomNamespaceLookups = 0;
  const env = {
    CHAT_SYNC: {
      async get() { return null; },
      async put() {},
    },
    ROYALE_ROOM: {
      idFromName() {
        roomNamespaceLookups += 1;
        throw new Error('Unowned game path reached the Royale room namespace.');
      },
      get() {
        roomNamespaceLookups += 1;
        throw new Error('Unowned game path reached the Royale room namespace.');
      },
    },
  };
  const paths = [
    ['GET', '/api/games/archery/v1/cards'],
    ['GET', '/api/games/mini-royale/v2/cards'],
    ['GET', '/api/games/mini-royale/v1/cards/unknown'],
    ['POST', '/api/games/archery/v1/rooms/ROOM42/invite'],
  ];

  for (const [method, pathname] of paths) {
    const request = new Request(`https://api.test${pathname}`, { method });
    const response = await handleApiRequest(request, env, new URL(request.url));
    assert.equal(response.status, 404, `${method} ${pathname}`);
  }
  assert.equal(roomNamespaceLookups, 0);
});
