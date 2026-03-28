import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

import { handleGoogleLogin, handleLogout, handleMe } from './auth.js';
import {
  getDeckForUser,
  listCards,
  listDecksForUser,
  saveDeckForUser
} from './royale_repository.js';
import { RoyaleRoom } from './royale_room.js';
import {
  handleGetCurrentUser,
  handleUpdateCurrentUser,
  handleUpdateLocale,
  handleUpdateThemeMode,
  handleUpdateUiPreferences
} from './users.js';
import { corsHeaders, getCurrentUser, jsonResponse } from './utils.js';

async function handleHealth(request) {
  return jsonResponse({ ok: true, message: 'taiwan brawl api alive' }, 200, request);
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => {
    const index = Math.floor(Math.random() * alphabet.length);
    return alphabet[index];
  }).join('');
}

function getRoomStub(env, code) {
  return env.ROYALE_ROOM.get(env.ROYALE_ROOM.idFromName(code));
}

async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return null;
  }
  return user;
}

async function proxyRoomJson(stub, path, payload, request, user) {
  const upstream = await stub.fetch(
    new Request(`https://royale-room${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  );

  const data = await upstream.json();
  return jsonResponse(data, upstream.status, request);
}

async function handleListCards(request, env) {
  const cards = await listCards(env);
  return jsonResponse({ ok: true, cards }, 200, request);
}

async function handleListDecks(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const decks = await listDecksForUser(user.id, env);
  return jsonResponse({ ok: true, decks }, 200, request);
}

async function handleSaveDeck(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ error: 'Invalid body' }, 400, request);
  }

  const deck = await saveDeckForUser(user.id, body, env);
  return jsonResponse({ ok: true, deck }, 200, request);
}

async function resolveOwnedDeck(request, env, user, body) {
  const deckId = Number(body?.deckId);
  if (!Number.isInteger(deckId) || deckId <= 0) {
    return { error: jsonResponse({ error: 'deckId is required' }, 400, request) };
  }

  const deck = await getDeckForUser(user.id, deckId, env);
  if (!deck) {
    return { error: jsonResponse({ error: 'Deck not found' }, 404, request) };
  }

  return { deck };
}

async function handleCreateRoom(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const { deck, error } = await resolveOwnedDeck(request, env, user, body);
  if (error) {
    return error;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomRoomCode();
    const stub = getRoomStub(env, code);
    const upstream = await stub.fetch(
      new Request('https://royale-room/internal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          user: { id: user.id, name: user.name },
          deck
        })
      })
    );

    if (upstream.status === 409) {
      continue;
    }

    const data = await upstream.json();
    return jsonResponse(data, upstream.status, request);
  }

  return jsonResponse({ error: 'Unable to allocate room code' }, 500, request);
}

async function handleJoinRoom(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const { deck, error } = await resolveOwnedDeck(request, env, user, body);
  if (error) {
    return error;
  }

  const stub = getRoomStub(env, code);
  return proxyRoomJson(
    stub,
    '/internal/join',
    {
      user: { id: user.id, name: user.name },
      deck
    },
    request,
    user
  );
}

async function handleReadyRoom(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const stub = getRoomStub(env, code);
  return proxyRoomJson(
    stub,
    '/internal/ready',
    { userId: user.id },
    request,
    user
  );
}

async function handleRoomState(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const stub = getRoomStub(env, code);
  const upstream = await stub.fetch(
    new Request('https://royale-room/internal/state', {
      method: 'GET',
      headers: { 'x-user-id': String(user.id) }
    })
  );

  const data = await upstream.json();
  return jsonResponse(data, upstream.status, request);
}

async function handleRoomWebSocket(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ error: 'Expected WebSocket upgrade' }, 426, request);
  }

  const stub = getRoomStub(env, code);
  const headers = new Headers(request.headers);
  headers.set('x-user-id', String(user.id));
  headers.set('x-user-name', user.name);

  return stub.fetch(
    new Request('https://royale-room/internal/ws', {
      method: 'GET',
      headers
    })
  );
}

function matchRoomRoute(pathname) {
  const match = pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|ready|state|ws)$/);
  if (!match) {
    return null;
  }

  return {
    code: match[1],
    action: match[2]
  };
}

async function handleApiRequest(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return handleHealth(request);
  }
  if (request.method === 'GET' && url.pathname === '/api/me') {
    return handleMe(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/users/me') {
    return handleGetCurrentUser(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/me') {
    return handleUpdateCurrentUser(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/theme-mode') {
    return handleUpdateThemeMode(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/ui-preferences') {
    return handleUpdateUiPreferences(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/locale') {
    return handleUpdateLocale(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    return handleLogout(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/google-login') {
    return handleGoogleLogin(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/cards') {
    return handleListCards(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/decks') {
    return handleListDecks(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/decks') {
    return handleSaveDeck(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    return handleCreateRoom(request, env);
  }

  const roomRoute = matchRoomRoute(url.pathname);
  if (roomRoute) {
    if (request.method === 'POST' && roomRoute.action === 'join') {
      return handleJoinRoom(request, env, roomRoute.code);
    }
    if (request.method === 'POST' && roomRoute.action === 'ready') {
      return handleReadyRoom(request, env, roomRoute.code);
    }
    if (request.method === 'GET' && roomRoute.action === 'state') {
      return handleRoomState(request, env, roomRoute.code);
    }
    if (request.method === 'GET' && roomRoute.action === 'ws') {
      return handleRoomWebSocket(request, env, roomRoute.code);
    }
  }

  return jsonResponse({ error: 'Not Found' }, 404, request);
}

export { RoyaleRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env, url);
      } catch (error) {
        return jsonResponse(
          { error: 'Internal server error', detail: error.message },
          500,
          request
        );
      }
    }

    try {
      let assetRequest = request;
      if (url.pathname === '/') {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = '/index.html';
        assetRequest = new Request(indexUrl, request);
      }

      return await getAssetFromKV(
        { request: assetRequest },
        {
          ASSET_NAMESPACE: env.STATIC_ASSETS
        }
      );
    } catch (_) {
      try {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = '/index.html';
        const indexRequest = new Request(indexUrl, request);
        return await getAssetFromKV(
          { request: indexRequest },
          {
            ASSET_NAMESPACE: env.STATIC_ASSETS
          }
        );
      } catch (error) {
        return jsonResponse({ error: 'Not Found', detail: error.message }, 404, request);
      }
    }
  }
};
