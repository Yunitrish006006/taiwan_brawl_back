import { requireUser } from '../core/request_helpers.js';
import { jsonResponse } from '../core/utils.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function signalDoName(userIdA, userIdB) {
  const a = Number(userIdA);
  const b = Number(userIdB);
  return `signal:${Math.min(a, b)}:${Math.max(a, b)}`;
}

function getSignalRoomStub(env, userIdA, userIdB) {
  const id = env.SIGNAL_ROOM.idFromName(signalDoName(userIdA, userIdB));
  return env.SIGNAL_ROOM.get(id);
}

async function areFriends(userId, friendId, env) {
  const a = Number(userId);
  const b = Number(friendId);
  const [userOneId, userTwoId] = a < b ? [a, b] : [b, a];
  const row = await env.DB.prepare(
    'SELECT 1 FROM friendships WHERE user_one_id = ?1 AND user_two_id = ?2 LIMIT 1'
  )
    .bind(userOneId, userTwoId)
    .first();
  return Boolean(row);
}

// ── handler ───────────────────────────────────────────────────────────────────

async function handleSignalWebSocket(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ error: 'Expected WebSocket upgrade' }, 426, request);
  }

  const friends = await areFriends(user.id, friendId, env);
  if (!friends) {
    return jsonResponse({ error: 'Not friends' }, 403, request);
  }

  const stub = getSignalRoomStub(env, user.id, friendId);
  const headers = new Headers(request.headers);
  headers.set('x-user-id', String(user.id));

  return stub.fetch(
    new Request('https://signal-room/internal/signal', {
      method: 'GET',
      headers
    })
  );
}

// ── exports ───────────────────────────────────────────────────────────────────

export function matchSignalRoute(pathname) {
  const match = pathname.match(/^\/api\/chat\/signal\/(\d+)$/);
  if (!match) return null;
  return { friendId: Number(match[1]) };
}

export async function handleDynamicSignalRoutes(request, env, url) {
  const route = matchSignalRoute(url.pathname);
  if (!route) return null;

  if (request.method === 'GET') {
    return handleSignalWebSocket(request, env, route.friendId);
  }
  return null;
}
