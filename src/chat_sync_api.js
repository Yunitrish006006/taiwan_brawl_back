import { requireUser } from './request_helpers.js';
import { jsonResponse } from './utils.js';

// Chat history sync via KV — lets a user upload their local Hive data so another
// device can download and merge it.  Data is stored under key `chat_sync:<userId>`
// with a short TTL so the server never becomes a long-term storage backend.

const SYNC_TTL_SECONDS = 3600; // 1 hour
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024; // 20 MB guard

export async function handleSyncUpload(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ error: 'Payload too large' }, 413, request);
  }

  let body;
  try {
    body = await request.text();
    // Validate it's parseable JSON before storing
    JSON.parse(body);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request);
  }

  const key = `chat_sync:${user.id}`;
  await env.CHAT_SYNC.put(key, body, { expirationTtl: SYNC_TTL_SECONDS });

  return jsonResponse({ ok: true, expiresInSeconds: SYNC_TTL_SECONDS }, 200, request);
}

export async function handleSyncDownload(request, env) {
  const user = await requireUser(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, 401, request);

  const key = `chat_sync:${user.id}`;
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
