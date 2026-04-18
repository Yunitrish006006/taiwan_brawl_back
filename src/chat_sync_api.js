import { requireUser } from './request_helpers.js';
import { jsonResponse } from './utils.js';

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
  await env.CHAT_SYNC.put(key, body, { expirationTtl: SYNC_TTL_SECONDS });

  return jsonResponse({ ok: true, expiresInSeconds: SYNC_TTL_SECONDS }, 200, request);
}

export async function handleSyncDownload(request, env, friendId) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

    const key = syncKey(user.id, friendId);
  const data = await env.CHAT_SYNC.get(key);
  if (data === null) {
    return jsonResponse({ ok: false, error: 'No sync data available' }, 404, request);
  }

  // Delete immediately after download (one-time transfer)
  await env.CHAT_SYNC.delete(key);

  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}
