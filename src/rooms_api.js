import { normalizeSimulationMode } from './royale_battle_rules.js';
import {
  getDeckForUser,
  listCards,
  listDecksForUser,
  saveDeckForUser
} from './royale_repository.js';
import { matchRoomRoute } from './route_patterns.js';
import { handleSendRoomInvite } from './friends_api.js';
import { requireUser, withAuthenticatedUser } from './request_helpers.js';
import {
  getRoomStub,
  proxyRoomAction,
  proxyRoomJson,
  randomRoomCode
} from './royale_room_proxy.js';
import { jsonResponse } from './utils.js';

async function handleListCards(request, env) {
  const cards = await listCards(env);
  return jsonResponse({ ok: true, cards }, 200, request);
}

async function handleListDecks(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const decks = await listDecksForUser(user.id, env);
    return jsonResponse({ ok: true, decks }, 200, request);
  });
}

async function handleSaveDeck(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ error: 'Invalid body' }, 400, request);
    }

    const deck = await saveDeckForUser(user.id, body, env);
    return jsonResponse({ ok: true, deck }, 200, request);
  });
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
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const { deck, error } = await resolveOwnedDeck(request, env, user, body);
    if (error) {
      return error;
    }
    const vsBot = Boolean(body?.vsBot);
    const simulationMode = vsBot ? 'host' : normalizeSimulationMode(body?.simulationMode);

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
            deck,
            vsBot,
            botDeck: deck,
            simulationMode
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
  });
}

async function handleJoinRoom(request, env, code) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const { deck, error } = await resolveOwnedDeck(request, env, user, body);
    if (error) {
      return error;
    }

    return proxyRoomAction(request, env, code, '/internal/join', async () => ({
      user: { id: user.id, name: user.name },
      deck
    }));
  });
}

async function handleReadyRoom(request, env, code) {
  return proxyRoomAction(request, env, code, '/internal/ready', async (user) => ({
    userId: user.id
  }));
}

async function handleRematchRoom(request, env, code) {
  return proxyRoomAction(request, env, code, '/internal/rematch', async (user) => ({
    userId: user.id
  }));
}

async function handleHostFinishRoom(request, env, code) {
  const body = await request.json().catch(() => null);
  return proxyRoomAction(request, env, code, '/internal/host-finish', async (user) => ({
    userId: user.id,
    winnerSide: body?.winnerSide ?? null,
    reason: body?.reason ?? 'time_up',
    leftTowerHp: body?.leftTowerHp,
    rightTowerHp: body?.rightTowerHp
  }));
}

async function handleRoomState(request, env, code) {
  return withAuthenticatedUser(request, env, async (user) => {
    const stub = getRoomStub(env, code);
    const upstream = await stub.fetch(
      new Request('https://royale-room/internal/state', {
        method: 'GET',
        headers: { 'x-user-id': String(user.id) }
      })
    );

    const data = await upstream.json();
    return jsonResponse(data, upstream.status, request);
  });
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

export function exactRoomsApiRouteHandler(request, env, url) {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/cards':
      return () => handleListCards(request, env);
    case 'GET /api/decks':
      return () => handleListDecks(request, env);
    case 'POST /api/decks':
      return () => handleSaveDeck(request, env);
    case 'POST /api/rooms':
      return () => handleCreateRoom(request, env);
    default:
      return null;
  }
}

export async function handleDynamicRoomRoutes(request, env, url) {
  const roomRoute = matchRoomRoute(url.pathname);
  if (!roomRoute) {
    return null;
  }

  switch (`${request.method} ${roomRoute.action}`) {
    case 'POST join':
      return handleJoinRoom(request, env, roomRoute.code);
    case 'POST ready':
      return handleReadyRoom(request, env, roomRoute.code);
    case 'POST rematch':
      return handleRematchRoom(request, env, roomRoute.code);
    case 'POST host-finish':
      return handleHostFinishRoom(request, env, roomRoute.code);
    case 'GET state':
      return handleRoomState(request, env, roomRoute.code);
    case 'GET ws':
      return handleRoomWebSocket(request, env, roomRoute.code);
    case 'POST invite':
      return handleSendRoomInvite(request, env, roomRoute.code);
    default:
      return null;
  }
}
