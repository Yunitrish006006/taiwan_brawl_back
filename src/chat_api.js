import { requireUser } from './request_helpers.js';
import { jsonResponse } from './utils.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function dmDoName(userIdA, userIdB) {
  const a = Number(userIdA);
  const b = Number(userIdB);
  return `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
}

function getChatRoomStub(env, userIdA, userIdB) {
  const id = env.CHAT_ROOM.idFromName(dmDoName(userIdA, userIdB));
  return env.CHAT_ROOM.get(id);
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

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleDmHistory(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const friends = await areFriends(user.id, friendId, env);
  if (!friends) {
    return jsonResponse({ error: 'Not friends' }, 403, request);
  }

  const url = new URL(request.url);
  const before = url.searchParams.get('before') ?? '';
  const stub = getChatRoomStub(env, user.id, friendId);

  const innerUrl = new URL('https://chat-room/internal/history');
  innerUrl.searchParams.set('userA', String(user.id));
  innerUrl.searchParams.set('userB', String(friendId));
  if (before) {
    innerUrl.searchParams.set('before', before);
  }

  return stub.fetch(new Request(innerUrl.toString()));
}

async function handleDmWebSocket(request, env, friendId) {
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

  const stub = getChatRoomStub(env, user.id, friendId);
  const headers = new Headers(request.headers);
  headers.set('x-user-id', String(user.id));
  headers.set('x-receiver-id', String(friendId));

  return stub.fetch(
    new Request('https://chat-room/internal/ws', {
      method: 'GET',
      headers
    })
  );
}

// ── exports ───────────────────────────────────────────────────────────────────

export function matchChatDmRoute(pathname) {
  const match = pathname.match(/^\/api\/chat\/dm\/(\d+)\/(history|ws)$/);
  if (!match) {
    return null;
  }
  return {
    friendId: Number(match[1]),
    action: match[2]
  };
}

export async function handleDynamicChatRoutes(request, env, url) {
  const route = matchChatDmRoute(url.pathname);
  if (!route) {
    return null;
  }

  switch (`${request.method} ${route.action}`) {
    case 'GET history':
      return handleDmHistory(request, env, route.friendId);
    case 'GET ws':
      return handleDmWebSocket(request, env, route.friendId);
    default:
      return null;
  }
}
