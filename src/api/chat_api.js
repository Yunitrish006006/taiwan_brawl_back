import { socialDatabase, splitMode, socialPairAllowed } from '../core/databases.js';
import { requireUser } from '../core/request_helpers.js';
import { sendDirectMessagePush } from '../features/push_notifications.js';
import { jsonResponse } from '../core/utils.js';
import {
  handleSyncUpload,
  handleSyncDownload,
  handleSyncDownloadV2,
  handleSyncAcknowledge,
} from './chat_sync_api.js';
import {
  eventFromPendingRow,
  normalizeChatEvent,
  pendingRowMatchesEvent,
  pendingTypeForEvent
} from './chat_event_contract.js';

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
  if(splitMode(env)) return socialPairAllowed(env,Number(userId),Number(friendId));
  const a = Number(userId);
  const b = Number(friendId);
  const [userOneId, userTwoId] = a < b ? [a, b] : [b, a];
  const row = await socialDatabase(env).prepare(
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
  const beforeId = url.searchParams.get('beforeId') ?? '';
  const stub = getChatRoomStub(env, user.id, friendId);

  const innerUrl = new URL('https://chat-room/internal/history');
  innerUrl.searchParams.set('userA', String(user.id));
  innerUrl.searchParams.set('userB', String(friendId));
  if (before) {
    innerUrl.searchParams.set('before', before);
    if (beforeId) innerUrl.searchParams.set('beforeId', beforeId);
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
  await socialDatabase(env).prepare(
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

async function handleSendEvent(request, env, friendId, ctx) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const friends = await areFriends(user.id, friendId, env);
  if (!friends) return jsonResponse({ error: 'Not friends' }, 403, request);

  const body = await request.json().catch(() => null);
  const normalized = normalizeChatEvent(body?.event, {
    actorId: user.id,
    friendId
  });
  if (normalized.error) return jsonResponse({ error: normalized.error }, 400, request);
  const event = normalized.event;
  const pendingType = pendingTypeForEvent(event.type);

  const existing = await socialDatabase(env).prepare(
    'SELECT id, event_id, message_id, sender_id, receiver_id, text, created_at, revision, event_type, signature, device_id FROM pending_messages WHERE event_id = ?1 LIMIT 1'
  )
    .bind(event.eventId)
    .first();
  if (existing) {
    if (
      !pendingRowMatchesEvent(existing, event, {
        actorId: user.id,
        friendId
      })
    ) {
      return jsonResponse({ error: 'event_id conflicts with an existing event' }, 409, request);
    }
    return jsonResponse({ ok: true, event }, 200, request);
  }

  await socialDatabase(env).prepare(
    `INSERT INTO pending_messages
      (sender_id, receiver_id, text, created_at, type, event_id, message_id, revision, event_type, signature, device_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  )
    .bind(
      user.id,
      friendId,
      event.body ?? '',
      event.createdAt,
      pendingType,
      event.eventId,
      event.messageId,
      event.revision,
      event.type,
      event.signature,
      event.deviceId ?? null
    )
    .run();

  if (event.type === 'created' || event.type === 'edited' || event.type === 'recalled') {
    await runBackgroundTask(
      ctx,
      sendDirectMessagePush(env, {
        senderId: user.id,
        senderName: user.name,
        receiverId: friendId,
        text: event.type === 'recalled' ? '' : event.body ?? '',
        kind: event.type === 'recalled' ? 'recall' : 'message',
        appOrigin: new URL(request.url).origin,
      })
    );
  }

  return jsonResponse({ ok: true, event }, 201, request);
}

async function handleGetPending(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const url = new URL(request.url);
  const deviceId = normalizeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return jsonResponse({ error: 'Valid deviceId is required' }, 400, request);
  const device = await getActiveChatDevice(env, user.id, deviceId);
  if (!device) return jsonResponse({ error: 'Device is not active' }, 403, request);
  const friendIdParam = url.searchParams.get('friendId');
  const friendId = friendIdParam == null ? null : Number(friendIdParam);
  if (friendIdParam != null && (!Number.isInteger(friendId) || friendId <= 0)) {
    return jsonResponse({ error: 'Invalid friendId' }, 400, request);
  }
  if (friendId != null && !(await areFriends(user.id, friendId, env))) {
    return jsonResponse({ error: 'Not friends' }, 403, request);
  }
  const afterIdParam = url.searchParams.get('afterId');
  const afterId = afterIdParam == null ? null : Number(afterIdParam);
  if (afterIdParam != null && (!Number.isInteger(afterId) || afterId < 0)) {
    return jsonResponse({ error: 'Invalid afterId' }, 400, request);
  }
  const rawLimit = Number(url.searchParams.get('limit') ?? 50);
  const rawOffset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Math.max(1, Math.min(100, Number.isInteger(rawLimit) ? rawLimit : 50));
  const offset = Math.max(0, Number.isInteger(rawOffset) ? rawOffset : 0);

  const conditions = ['receiver_id = ?1'];
  const bindings = [user.id];
  let nextBinding = 2;
  if (friendId != null) {
    conditions.push(`sender_id = ?${nextBinding}`);
    bindings.push(friendId);
    nextBinding += 1;
  }
  if (afterId != null) {
    conditions.push(`id > ?${nextBinding}`);
    bindings.push(afterId);
    nextBinding += 1;
  }
  conditions.push(
    `NOT EXISTS (SELECT 1 FROM chat_pending_message_acks a WHERE a.pending_id = pending_messages.id AND a.device_id = ?${nextBinding})`
  );
  bindings.push(deviceId);
  nextBinding += 1;
  const where = conditions.join(' AND ');
  const limitBinding = nextBinding;
  const offsetBinding = nextBinding + 1;

  const [rows, countRow] = await Promise.all([
    socialDatabase(env).prepare(
      `SELECT id, sender_id, receiver_id, text, created_at, type, event_id, message_id, revision, event_type, signature, device_id FROM pending_messages WHERE ${where} ORDER BY id ASC LIMIT ?${limitBinding} OFFSET ?${offsetBinding}`
    )
      .bind(...bindings, limit, offset)
      .all(),
    socialDatabase(env).prepare(
      `SELECT COUNT(*) AS total FROM pending_messages WHERE ${where}`
    )
      .bind(...bindings)
      .first(),
  ]);

  const total = Number(countRow?.total || 0);
  return jsonResponse({
    messages: rows.results || [],
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  }, 200, request);
}

async function handleAckPending(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const body = await request.json().catch(() => null);
  const deviceId = normalizeDeviceId(body?.deviceId);
  if (!deviceId) return jsonResponse({ error: 'Valid deviceId is required' }, 400, request);
  const device = await getActiveChatDevice(env, user.id, deviceId);
  if (!device) return jsonResponse({ error: 'Device is not active' }, 403, request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return jsonResponse({ ok: true, deleted: 0 }, 200, request);
  const uniqueIds = [...new Set(ids)];
  const acknowledgedAt = new Date().toISOString();
  for (const pendingId of uniqueIds) {
    await socialDatabase(env).prepare(
      'INSERT OR IGNORE INTO chat_pending_message_acks (pending_id, receiver_id, device_id, acknowledged_at) SELECT id, receiver_id, ?3, ?4 FROM pending_messages WHERE id = ?1 AND receiver_id = ?2'
    ).bind(pendingId, user.id, deviceId, acknowledgedAt).run();
  }
  const placeholders = uniqueIds.map((_, index) => `?${index + 2}`).join(',');
  const result = await socialDatabase(env).prepare(
    `DELETE FROM pending_messages
     WHERE receiver_id = ?1 AND id IN (${placeholders})
       AND EXISTS (SELECT 1 FROM chat_devices active WHERE active.user_id = pending_messages.receiver_id AND active.is_active = 1)
       AND NOT EXISTS (
         SELECT 1 FROM chat_devices d
         WHERE d.user_id = pending_messages.receiver_id AND d.is_active = 1
           AND NOT EXISTS (
             SELECT 1 FROM chat_pending_message_acks a
             WHERE a.pending_id = pending_messages.id
               AND a.receiver_id = pending_messages.receiver_id
               AND a.device_id = d.device_id
           )
       )`
  ).bind(user.id, ...uniqueIds).run();

  return jsonResponse({ ok: true, deleted: result.meta?.changes ?? 0 }, 200, request);
}

function normalizeDeviceId(value) {
  const deviceId = typeof value === 'string' ? value.trim() : '';
  return deviceId.length > 0 && deviceId.length <= 128 ? deviceId : null;
}

async function getActiveChatDevice(env, userId, deviceId) {
  return socialDatabase(env).prepare(
    'SELECT device_id FROM chat_devices WHERE user_id = ?1 AND device_id = ?2 AND is_active = 1 LIMIT 1'
  ).bind(userId, deviceId).first();
}

async function handleRegisterChatDevice(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);
  const body = await request.json().catch(() => null);
  const deviceId = normalizeDeviceId(body?.deviceId);
  if (!deviceId) return jsonResponse({ error: 'Valid deviceId is required' }, 400, request);
  const now = new Date().toISOString();
  await socialDatabase(env).prepare(
    `INSERT INTO chat_devices (user_id, device_id, is_active, created_at, last_seen_at)
     VALUES (?1, ?2, 1, ?3, ?3)
     ON CONFLICT(user_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
     WHERE chat_devices.is_active = 1`
  ).bind(user.id, deviceId, now).run();
  const device = await socialDatabase(env).prepare(
    'SELECT device_id, is_active FROM chat_devices WHERE user_id = ?1 AND device_id = ?2 LIMIT 1'
  ).bind(user.id, deviceId).first();
  if (!device?.is_active) return jsonResponse({ error: 'Device was revoked' }, 403, request);
  return jsonResponse({ ok: true, deviceId }, 200, request);
}

async function handleListChatDevices(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);
  const devices = await socialDatabase(env).prepare(
    'SELECT device_id, created_at, last_seen_at FROM chat_devices WHERE user_id = ?1 AND is_active = 1 ORDER BY last_seen_at DESC, device_id ASC'
  ).bind(user.id).all();
  return jsonResponse({ devices: devices.results || [] }, 200, request);
}

async function handleRevokeChatDevice(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);
  const body = await request.json().catch(() => null);
  const deviceId = normalizeDeviceId(body?.deviceId);
  if (!deviceId) return jsonResponse({ error: 'Valid deviceId is required' }, 400, request);
  await socialDatabase(env).prepare(
    'UPDATE chat_devices SET is_active = 0, revoked_at = ?3 WHERE user_id = ?1 AND device_id = ?2 AND is_active = 1'
  ).bind(user.id, deviceId, new Date().toISOString()).run();
  await socialDatabase(env).prepare(
    `DELETE FROM pending_messages
     WHERE receiver_id = ?1
       AND EXISTS (SELECT 1 FROM chat_devices active WHERE active.user_id = pending_messages.receiver_id AND active.is_active = 1)
       AND NOT EXISTS (
       SELECT 1 FROM chat_devices d
       WHERE d.user_id = pending_messages.receiver_id AND d.is_active = 1
         AND NOT EXISTS (
           SELECT 1 FROM chat_pending_message_acks a
           WHERE a.pending_id = pending_messages.id
             AND a.receiver_id = pending_messages.receiver_id AND a.device_id = d.device_id
         )
     )`
  ).bind(user.id).run();
  return jsonResponse({ ok: true }, 200, request);
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
  await socialDatabase(env).prepare(
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
  const match = pathname.match(/^\/api\/chat\/dm\/(\d+)\/(history|ws|send|event|recall)$/) ??
    pathname.match(/^\/api\/chat\/dm\/(\d+)\/(sync-upload|sync-download|sync-download-v2|sync-ack)$/) ??
    pathname.match(/^\/api\/chat\/dm\/(pending|ack|devices|device-register|device-revoke)$/);
  if (!match) return null;

  // Shared pending/ack routes (no friendId)
  if (['pending', 'ack', 'devices', 'device-register', 'device-revoke'].includes(match[1])) {
    return { action: match[1], friendId: null };
  }

  return { friendId: Number(match[1]), action: match[2] };
}

export async function handleDynamicChatRoutes(request, env, url, ctx) {
  const route = matchChatDmRoute(url.pathname);
  if (!route) return null;
  if(splitMode(env) && route.action.startsWith('sync-')) {
    const user=await requireUser(request,env);
    if(!user) return jsonResponse({error:'Not logged in'},401,request);
    if(!(await areFriends(user.id,route.friendId,env))) return jsonResponse({error:'Not friends'},403,request);
  }

  switch (`${request.method} ${route.action}`) {
    case 'GET history':
      return handleDmHistory(request, env, route.friendId);
    case 'GET ws':
      return handleDmWebSocket(request, env, route.friendId);
    case 'POST send':
      return handleSendPending(request, env, route.friendId, ctx);
    case 'POST event':
      return handleSendEvent(request, env, route.friendId, ctx);
    case 'POST recall':
      return handleRecallMessage(request, env, route.friendId, ctx);
    case 'GET pending':
      return handleGetPending(request, env);
    case 'POST ack':
      return handleAckPending(request, env);
    case 'POST device-register':
      return handleRegisterChatDevice(request, env);
    case 'GET devices':
      return handleListChatDevices(request, env);
    case 'POST device-revoke':
      return handleRevokeChatDevice(request, env);
    case 'POST sync-upload':
      return handleSyncUpload(request, env, route.friendId);
    case 'GET sync-download':
      return handleSyncDownload(request, env, route.friendId);
    case 'GET sync-download-v2':
      return handleSyncDownloadV2(request, env, route.friendId);
    case 'POST sync-ack':
      return handleSyncAcknowledge(request, env, route.friendId);
    default:
      return null;
  }
}
