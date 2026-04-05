import { normalizeRole } from './permissions.js';

export const USER_SELECT_COLUMNS = `SELECT id, name, email, role, bio, avatar_url, google_avatar_url,
        custom_avatar_url, avatar_source, uploaded_avatar_version,
        last_active_at, theme_mode, font_size_scale, locale,
        llm_base_url, llm_model, llm_api_key
 FROM users`;

export function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true'
  };
}

export function jsonResponse(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json'
    }
  });
}

export function generateSessionId() {
  return crypto.randomUUID();
}

export function setCookie(name, value, maxAge = 3600) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=None; Secure`;
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

export async function getCurrentUser(request, env) {
  const sessionId = parseSessionId(request);
  if (!sessionId) return null;

  const session = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first();

  if (!session || new Date(session.expires_at) < new Date()) {
    return null;
  }

  await env.DB.prepare(
    'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind(session.user_id)
    .run();

  return fetchMappedUserById(env, session.user_id);
}
