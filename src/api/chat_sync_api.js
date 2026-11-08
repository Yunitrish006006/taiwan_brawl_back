import { requireUser } from '../core/request_helpers.js';
import { jsonResponse } from '../core/utils.js';

// Chat history sync via KV — lets a user upload a single conversation so another
// device can download and merge it.  Data is stored per-conversation under key
// `chat_sync:<low_id>:<high_id>` with a short TTL.

const SYNC_TTL_SECONDS = 3600; // 1 hour
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB per conversation

function syncKey(userIdA, userIdB) {
    const a = Number(userIdA);
    const b = Number(userIdB);
    return `chat_sync:${Math.min(a, b)}:${Math.max(a, b)}`;
}

function syncAckKey(userIdA, userIdB) {
  const a = Number(userIdA);
  const b = Number(userIdB);
  return `chat_sync_ack:${Math.min(a, b)}:${Math.max(a, b)}`;
}

async function readSnapshot(env, key) {
  let data;
  let metadata = null;
  if (typeof env.CHAT_SYNC.getWithMetadata === 'function') {
    ({ value: data, metadata } = await env.CHAT_SYNC.getWithMetadata(key, 'text'));
  } else {
    data = await env.CHAT_SYNC.get(key);
  }
  if (data === null) return null;
  const snapshotId = metadata?.snapshotId ?? await snapshotDigest(data);
  return { data, snapshotId };
}

async function snapshotDigest(data) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function handleSyncUpload(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ error: 'Payload too large' }, 413, request);
  }

  let body;
  try {
      body = await request.text();
    JSON.parse(body);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request);
  }

  const key = syncKey(user.id, friendId);
  const snapshotId = crypto.randomUUID();
  await env.CHAT_SYNC.put(key, body, {
    expirationTtl: SYNC_TTL_SECONDS,
    metadata: { snapshotId },
  });

  return jsonResponse({ ok: true, expiresInSeconds: SYNC_TTL_SECONDS }, 200, request);
}

export async function handleSyncDownload(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const key = syncKey(user.id, friendId);
  const snapshot = await readSnapshot(env, key);
  if (!snapshot) {
    return jsonResponse({ ok: false, error: 'No sync data available' }, 404, request);
  }
  const acknowledgedId = await env.CHAT_SYNC.get(syncAckKey(user.id, friendId));
  if (acknowledgedId === snapshot.snapshotId) {
    await env.CHAT_SYNC.delete(key);
    return jsonResponse({ ok: false, error: 'No sync data available' }, 404, request);
  }

  // Delete immediately after download (one-time transfer)
  await env.CHAT_SYNC.delete(key);

  return new Response(snapshot.data, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

/// Retry-safe read used by current clients. The legacy route above remains
/// one-shot for older clients; this route retains the payload until the client
/// confirms that validation and local import have completed.
export async function handleSyncDownloadV2(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const key = syncKey(user.id, friendId);
  const snapshot = await readSnapshot(env, key);
  if (!snapshot) {
    return jsonResponse({ ok: false, error: 'No sync data available' }, 404, request);
  }
  const acknowledgedId = await env.CHAT_SYNC.get(syncAckKey(user.id, friendId));
  if (acknowledgedId === snapshot.snapshotId) {
    return jsonResponse({ ok: false, error: 'No sync data available' }, 404, request);
  }

  return new Response(snapshot.data, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'X-Chat-Snapshot-Id',
      'X-Chat-Snapshot-Id': snapshot.snapshotId,
    },
  });
}

export async function handleSyncAcknowledge(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request);
  }
  const snapshotId = body?.snapshotId;
  if (typeof snapshotId !== 'string' || !/^[a-f0-9-]{32,64}$/i.test(snapshotId)) {
    return jsonResponse({ error: 'Invalid snapshot ID' }, 400, request);
  }

  const snapshot = await readSnapshot(env, syncKey(user.id, friendId));
  if (!snapshot) {
    return jsonResponse({ error: 'No sync data available' }, 404, request);
  }
  if (snapshot.snapshotId !== snapshotId) {
    return jsonResponse({ error: 'Snapshot has changed' }, 409, request);
  }

  await env.CHAT_SYNC.put(syncAckKey(user.id, friendId), snapshotId, {
    expirationTtl: SYNC_TTL_SECONDS,
  });
  return jsonResponse({ ok: true }, 200, request);
}
