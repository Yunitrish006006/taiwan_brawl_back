import { requireUser } from './request_helpers.js';
import { sendDirectMessagePush } from './push_notifications.js';
import { jsonResponse } from './utils.js';
import { handleSyncUpload, handleSyncDownload } from './chat_sync_api.js';

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

// ── offline relay handlers ────────────────────────────────────────────────────

function runBackgroundTask(ctx, promise) {
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
    return;
  }
  return promise;
}

async function handleSendPending(request, env, friendId, ctx) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const friends = await areFriends(user.id, friendId, env);
  if (!friends) return jsonResponse({ error: 'Not friends' }, 403, request);

  const body = await request.json().catch(() => null);
  const text = String(body?.text ?? '').trim();
  if (!text) return jsonResponse({ error: 'Empty message' }, 400, request);

  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO pending_messages (sender_id, receiver_id, text, created_at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(user.id, friendId, text, createdAt)
    .run();

  await runBackgroundTask(
    ctx,
    sendDirectMessagePush(env, {
      senderId: user.id,
      senderName: user.name,
      receiverId: friendId,
      text,
      kind: 'message',
      appOrigin: new URL(request.url).origin,
    })
  );

  return jsonResponse({ ok: true, createdAt }, 201, request);
}

async function handleGetPending(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const rows = await env.DB.prepare(
    'SELECT id, sender_id, receiver_id, text, created_at, type FROM pending_messages WHERE receiver_id = ?1 ORDER BY created_at ASC'
  )
    .bind(user.id)
    .all();

  return jsonResponse({ messages: rows.results }, 200, request);
}

async function handleAckPending(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return jsonResponse({ ok: true, deleted: 0 }, 200, request);

  const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
  const result = await env.DB.prepare(
    `DELETE FROM pending_messages WHERE receiver_id = ?1 AND id IN (${placeholders})`
  )
    .bind(user.id, ...ids)
    .run();

  return jsonResponse({ ok: true, deleted: result.meta?.changes ?? 0 }, 200, request);
}

async function handleRecallMessage(request, env, friendId, ctx) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const friends = await areFriends(user.id, friendId, env);
  if (!friends) return jsonResponse({ error: 'Not friends' }, 403, request);

  const body = await request.json().catch(() => null);
  const messageKey = String(body?.messageKey ?? '').trim();
  if (!messageKey) return jsonResponse({ error: 'Missing messageKey' }, 400, request);

  const createdAt = new Date().toISOString();

  // Insert a recall notification into pending_messages for the receiver to pick up
  await env.DB.prepare(
    'INSERT INTO pending_messages (sender_id, receiver_id, text, created_at, type) VALUES (?1, ?2, ?3, ?4, \'recall\')'
  )
    .bind(user.id, friendId, messageKey, createdAt)
    .run();

  await runBackgroundTask(
    ctx,
    sendDirectMessagePush(env, {
      senderId: user.id,
      senderName: user.name,
      receiverId: friendId,
      text: '',
      kind: 'recall',
      appOrigin: new URL(request.url).origin,
    })
  );

  return jsonResponse({ ok: true }, 200, request);
}

// ── exports ───────────────────────────────────────────────────────────────────

export function matchChatDmRoute(pathname) {
  const match = pathname.match(/^\/api\/chat\/dm\/(\d+)\/(history|ws|send|recall)$/) ??
    pathname.match(/^\/api\/chat\/dm\/(\d+)\/(sync-upload|sync-download)$/) ??
    pathname.match(/^\/api\/chat\/dm\/(pending|ack)$/);
  if (!match) return null;

  // Shared pending/ack routes (no friendId)
  if (match[1] === 'pending' || match[1] === 'ack') {
    return { action: match[1], friendId: null };
  }

  return { friendId: Number(match[1]), action: match[2] };
}

export async function handleDynamicChatRoutes(request, env, url, ctx) {
  const route = matchChatDmRoute(url.pathname);
  if (!route) return null;

  switch (`${request.method} ${route.action}`) {
    case 'GET history':
      return handleDmHistory(request, env, route.friendId);
    case 'GET ws':
      return handleDmWebSocket(request, env, route.friendId);
    case 'POST send':
      return handleSendPending(request, env, route.friendId, ctx);
    case 'POST recall':
      return handleRecallMessage(request, env, route.friendId, ctx);
    case 'GET pending':
      return handleGetPending(request, env);
    case 'POST ack':
      return handleAckPending(request, env);
    case 'POST sync-upload':
      return handleSyncUpload(request, env, route.friendId);
    case 'GET sync-download':
      return handleSyncDownload(request, env, route.friendId);
    default:
      return null;
  }
}
