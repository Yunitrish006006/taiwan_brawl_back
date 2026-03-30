import {
  buildUploadedAvatarUrl,
  corsHeaders,
  fetchMappedUserById,
  generateSessionId,
  getCurrentUser,
  jsonResponse,
  parseSessionId,
  resolveAvatarUrlForSource,
  setCookie
} from './utils.js';

async function createSession(userId, env) {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sessionId, userId, expiresAt)
    .run();
  return sessionId;
}

async function findUserByEmail(env, email) {
  return env.DB.prepare(
    `SELECT id, name, email, google_sub, role, bio, avatar_url,
            google_avatar_url, custom_avatar_url, avatar_source,
            uploaded_avatar_version, last_active_at, theme_mode,
            font_size_scale, locale
     FROM users WHERE email = ?`
  )
    .bind(email)
    .first();
}

function decodeBase64Url(value) {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) {
    normalized += '=';
  }

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeGoogleIdToken(idToken) {
  const tokenParts = idToken.split('.');
  if (tokenParts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(tokenParts[1]));
    if (!payload?.sub || !payload?.email || payload.email_verified === false) {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture || null
    };
  } catch (_) {
    return null;
  }
}

export async function handleGoogleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.id_token) {
    return jsonResponse({ error: 'Missing id_token' }, 400, request);
  }

  const googleUser = decodeGoogleIdToken(body.id_token);
  if (!googleUser) {
    return jsonResponse({ error: 'Invalid Google token' }, 401, request);
  }

  let user = await findUserByEmail(env, googleUser.email);

  if (!user) {
    const defaultName = googleUser.name || googleUser.email.split('@')[0];
    await env.DB.prepare(
      `INSERT INTO users (
        name, email, google_sub, role, avatar_url, google_avatar_url,
        avatar_source, last_active_at
      ) VALUES (?, ?, ?, 'player', ?, ?, 'google', CURRENT_TIMESTAMP)`
    )
      .bind(
        defaultName,
        googleUser.email,
        googleUser.sub,
        googleUser.picture,
        googleUser.picture
      )
      .run();

    user = await findUserByEmail(env, googleUser.email);
  } else if (!user.google_sub) {
    await env.DB.prepare('UPDATE users SET google_sub = ? WHERE id = ?')
      .bind(googleUser.sub, user.id)
      .run();
    user.google_sub = googleUser.sub;
  } else if (user.google_sub !== googleUser.sub) {
    return jsonResponse({ error: 'Google account mismatch' }, 401, request);
  }

  const effectiveAvatarUrl = resolveAvatarUrlForSource({
    avatarSource: user.avatar_source,
    googleAvatarUrl: googleUser.picture,
    customAvatarUrl: user.custom_avatar_url ?? null,
    uploadedAvatarUrl: buildUploadedAvatarUrl(user.id, user.uploaded_avatar_version),
    fallbackAvatarUrl: user.avatar_url ?? null
  });

  await env.DB.prepare(
    `UPDATE users
     SET google_avatar_url = ?, avatar_url = ?, last_active_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(googleUser.picture, effectiveAvatarUrl, user.id)
    .run();

  user = await fetchMappedUserById(env, user.id);

  const sessionId = await createSession(user.id, env);
  return new Response(JSON.stringify({
    ok: true,
    session_id: sessionId,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      bio: user.bio,
      avatar_url: user.avatar_url,
      google_avatar_url: user.google_avatar_url,
      custom_avatar_url: user.custom_avatar_url,
      avatar_source: user.avatar_source,
      uploaded_avatar_url: user.uploaded_avatar_url,
      uploaded_avatar_version: user.uploaded_avatar_version,
      last_active_at: user.last_active_at,
      theme_mode: user.theme_mode,
      font_size_scale: user.font_size_scale,
      locale: user.locale
    }
  }), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie('session_id', sessionId, 30 * 24 * 3600)
    }
  });
}

export async function handleMe(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }
  return jsonResponse({ ok: true, user }, 200, request);
}

export async function handleLogout(request, env) {
  const sessionId = parseSessionId(request);
  if (sessionId) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie('session_id', '', 0)
    }
  });
}
