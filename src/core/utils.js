import { normalizeRole } from './permissions.js';

export const USER_SELECT_COLUMNS = `SELECT id, name, email, role, bio, avatar_url, google_avatar_url,
        custom_avatar_url, avatar_source, uploaded_avatar_version,
        last_active_at, theme_mode, font_size_scale, locale,
        llm_base_url, llm_model, llm_api_key
 FROM users`;

// Request ID generation and tracking
const REQUEST_ID_HEADER = 'X-Request-ID';

export function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().split('-')[0];
  return `${timestamp}-${random}`;
}

export function getRequestId(request) {
  return request.headers.get(REQUEST_ID_HEADER) || generateRequestId();
}

const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://taiwan-brawl-api.yunitrish0419.workers.dev'
]);

// Strict list of allowed localhost ports for development
const ALLOWED_LOCALHOST_PORTS = new Set([
  '3000', '3001', '3002',    // Common React/Vite dev servers
  '4200', '4201',            // Angular default
  '5000', '5001',            // Flask/Django
  '5173', '5174',            // Vite
  '8080', '8081',           // General dev
  '8888', '8889',           // Jupyter/Flask
  '4000', '4001',           // Flutter web default
]);

function requestOrigin(request) {
  try {
    return request?.url ? new URL(request.url).origin : null;
  } catch (_) {
    return null;
  }
}

function isAllowedLocalDevOrigin(origin) {
  if (!origin) return false;

  // Only allow http://localhost or http://127.0.0.1 (not https for local dev)
  const match = origin.match(/^https?:\/\/(localhost|127\.0\.0\.1):(\d+)$/);
  if (!match) return false;

  const port = match[2];
  // For localhost, only allow specific development ports
  // For 127.0.0.1, be slightly more permissive but still limited
  if (match[1] === '127.0.0.1') {
    return true; // Allow 127.0.0.1 with any port (less restrictive for local testing)
  }
  return ALLOWED_LOCALHOST_PORTS.has(port);
}

function isAllowedCorsOrigin(origin, request) {
  if (!origin) {
    return false; // Reject requests with no Origin header for API endpoints
  }
  return (
    origin === requestOrigin(request) ||
    DEFAULT_ALLOWED_ORIGINS.has(origin) ||
    isAllowedLocalDevOrigin(origin)
  );
}

export function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') ?? null;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID'
  };
  if (isAllowedCorsOrigin(origin, request)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Max-Age'] = '86400'; // Cache preflight for 24 hours
  }
  return headers;
}

export function jsonResponse(data, status = 200, request) {
  const requestId = getRequestId(request);
  const headers = {
    ...corsHeaders(request),
    'Content-Type': 'application/json',
    [REQUEST_ID_HEADER]: requestId,
  };

  // Add requestId to error responses
  if (status >= 400 && data && typeof data === 'object') {
    data = { ...data, requestId };
  }

  return new Response(JSON.stringify(data), { status, headers });
}

export function generateSessionId() {
  return crypto.randomUUID();
}

export function setCookie(name, value, maxAge = 3600) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=None; Secure; HttpOnly`;
}

export function buildUploadedAvatarUrl(userId, uploadedAvatarVersion) {
  const version = Number(uploadedAvatarVersion || 0);
  if (version <= 0) {
    return null;
  }
  return `/user-avatars/${encodeURIComponent(userId)}?v=${version}`;
}

export function resolveAvatarUrlForSource({
  avatarSource,
  googleAvatarUrl,
  customAvatarUrl,
  uploadedAvatarUrl,
  fallbackAvatarUrl = null
}) {
  const normalizedSource = ['custom', 'upload', 'google'].includes(avatarSource)
    ? avatarSource
    : 'google';

  if (normalizedSource === 'custom') {
    return customAvatarUrl ?? uploadedAvatarUrl ?? googleAvatarUrl ?? fallbackAvatarUrl ?? null;
  }
  if (normalizedSource === 'upload') {
    return uploadedAvatarUrl ?? googleAvatarUrl ?? customAvatarUrl ?? fallbackAvatarUrl ?? null;
  }
  return googleAvatarUrl ?? uploadedAvatarUrl ?? customAvatarUrl ?? fallbackAvatarUrl ?? null;
}

export function parseSessionIdFromCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

export function parseSessionId(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return parseSessionIdFromCookie(request);
}

export function mapUserRow(row) {
  if (!row) {
    return null;
  }

  const avatarSource = ['custom', 'upload', 'google'].includes(row.avatar_source)
    ? row.avatar_source
    : 'google';
  const googleAvatarUrl = row.google_avatar_url ?? null;
  const customAvatarUrl = row.custom_avatar_url ?? null;
  const uploadedAvatarVersion = Number(row.uploaded_avatar_version || 0);
  const uploadedAvatarUrl = buildUploadedAvatarUrl(row.id, uploadedAvatarVersion);
  const effectiveAvatarUrl = resolveAvatarUrlForSource({
    avatarSource,
    googleAvatarUrl,
    customAvatarUrl,
    uploadedAvatarUrl,
    fallbackAvatarUrl: row.avatar_url ?? null
  });

  return {
    ...row,
    role: normalizeRole(row.role),
    avatar_source: avatarSource,
    google_avatar_url: googleAvatarUrl,
    custom_avatar_url: customAvatarUrl,
    uploaded_avatar_version: uploadedAvatarVersion,
    uploaded_avatar_url: uploadedAvatarUrl,
    avatar_url: effectiveAvatarUrl,
    llm_base_url: row.llm_base_url ?? null,
    llm_model: row.llm_model ?? null,
    llm_api_key: undefined,
    llm_has_api_key: String(row.llm_api_key ?? '').trim().length > 0
  };
}

export async function fetchMappedUserById(env, userId) {
  const row = await env.DB.prepare(
    `${USER_SELECT_COLUMNS}
     WHERE id = ?`
  )
    .bind(userId)
    .first();
  return mapUserRow(row);
}

const LAST_ACTIVE_KV_PREFIX = 'last_active:';
const LAST_ACTIVE_THROTTLE_MS = 180_000; // 3 minutes

async function shouldUpdateLastActive(env, userId) {
  const key = `${LAST_ACTIVE_KV_PREFIX}${userId}`;
  try {
    const lastUpdate = await env.CHAT_SYNC?.get(key);
    if (lastUpdate) {
      const elapsed = Date.now() - Number(lastUpdate);
      if (elapsed < LAST_ACTIVE_THROTTLE_MS) {
        return false;
      }
    }
    return true;
  } catch (_) {
    return true; // KV unavailable, allow update
  }
}

async function markLastActiveUpdated(env, userId) {
  const key = `${LAST_ACTIVE_KV_PREFIX}${userId}`;
  try {
    await env.CHAT_SYNC?.put(key, String(Date.now()), { expirationTtl: 86400 });
  } catch (_) {
    // KV write failure is non-critical
  }
}

export async function getCurrentUser(request, env) {
  const sessionId = parseSessionId(request);
  if (!sessionId) return null;

  const session = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first();

  if (!session || new Date(session.expires_at) < new Date()) {
    return null;
  }

  // Throttle DB writes: only update if 3+ minutes since last update
  if (await shouldUpdateLastActive(env, session.user_id)) {
    await env.DB.prepare(
      'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(session.user_id)
      .run();
    await markLastActiveUpdated(env, session.user_id);
  }

  return fetchMappedUserById(env, session.user_id);
}
