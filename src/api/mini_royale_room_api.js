import { normalizeSimulationMode } from '../royale/royale_battle_rules.js';
import { normalizeBotController } from '../royale/royale_llm_bot.js';
import { getDeckSummaryForUser } from '../royale/royale_repository.js';
import { matchRoomRoute } from '../core/route_patterns.js';
import { requireUser, withAuthenticatedUser } from '../core/request_helpers.js';
import {
  getRoomStub,
  proxyRoomAction,
  randomRoomCode
} from '../royale/royale_room_proxy.js';
import { jsonResponse } from '../core/utils.js';
import {
  normalizeRoyaleGameContract
} from '../royale/royale_compatibility.js';
import { mapMiniRoyaleApiPath } from './game_api_paths.js';

async function resolveOwnedDeck(request, env, user, body) {
  const deckId = Number(body?.deckId);
  if (!Number.isInteger(deckId) || deckId <= 0) {
    return { error: jsonResponse({ error: 'deckId is required' }, 400, request) };
  }
  const deck = await getDeckSummaryForUser(user.id, deckId, env);
  if (!deck) {
    return { error: jsonResponse({ error: 'Deck not found' }, 404, request) };
  }
  return { deck: { ...deck, ownerUserId: user.id } };
}

function requestedHeroId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'ordinary_person';
}

async function handleCreateRoom(request, env) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const gameContract = normalizeRoyaleGameContract(body?.gameContract);
    if (!gameContract) {
      return jsonResponse({ error: 'INVALID_GAME_CONTRACT' }, 400, request);
    }
    const { deck, error } = await resolveOwnedDeck(request, env, user, body);
    if (error) return error;
    const vsBot = Boolean(body?.vsBot);
    const simulationMode = vsBot
      ? 'host'
      : normalizeSimulationMode(body?.simulationMode);
    const heroId = requestedHeroId(body?.heroId || deck.progression?.heroId);
    const botController = vsBot
      ? normalizeBotController(body?.botController)
      : 'heuristic';

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
            heroId,
            vsBot,
            botDeck: deck,
            botController,
            simulationMode,
            gameContract
          })
        })
      );
      if (upstream.status === 409) {
        const payload = await upstream.clone().json().catch(() => null);
        if (payload?.error !== 'Room already exists') {
          return jsonResponse(
            payload ?? { error: 'ROOM_CREATION_REJECTED' },
            upstream.status,
            request
          );
        }
        continue;
      }
      return jsonResponse(await upstream.json(), upstream.status, request);
    }
    return jsonResponse({ error: 'Unable to allocate room code' }, 500, request);
  });
}

async function handleJoinRoom(request, env, code) {
  return withAuthenticatedUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const { deck, error } = await resolveOwnedDeck(request, env, user, body);
    if (error) return error;
    return proxyRoomAction(request, env, code, '/internal/join', async () => ({
      user: { id: user.id, name: user.name },
      deck,
      heroId: requestedHeroId(body?.heroId || deck.progression?.heroId),
      gameContract: body?.gameContract
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
    return jsonResponse(await upstream.json(), upstream.status, request);
  });
}

async function handleRoomWebSocket(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);
  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ error: 'Expected WebSocket upgrade' }, 426, request);
  }
  const stub = getRoomStub(env, code);
  const headers = new Headers(request.headers);
  headers.set('x-user-id', String(user.id));
  headers.set('x-user-name', user.name);
  const query = new URL(request.url).search;
  return stub.fetch(
    new Request(`https://royale-room/internal/ws${query}`, { method: 'GET', headers })
  );
}

export function exactMiniRoyaleRoomApiRouteHandler(request, env, url) {
  const path = mapMiniRoyaleApiPath(url.pathname) ?? url.pathname;
  if (`${request.method} ${path}` === 'POST /api/rooms') {
    return () => handleCreateRoom(request, env);
  }
  return null;
}

export async function handleDynamicMiniRoyaleRoomRoutes(request, env, url) {
  const path = mapMiniRoyaleApiPath(url.pathname) ?? url.pathname;
  const roomRoute = matchRoomRoute(path);
  if (!roomRoute) return null;
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
    default:
      return null;
  }
}
