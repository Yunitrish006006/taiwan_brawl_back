import {
  corsHeaders,
  generateSessionId,
  getCurrentUser,
  jsonResponse,
  parseSessionId,
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
      name: payload.name
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

  let user = await env.DB.prepare(
    `SELECT id, name, email, google_sub, role, bio, theme_mode, font_size_scale, locale
     FROM users WHERE email = ?`
  )
    .bind(googleUser.email)
    .first();

  if (!user) {
    const defaultName = googleUser.name || googleUser.email.split('@')[0];
    await env.DB.prepare(
      `INSERT INTO users (name, email, password, google_sub, role)
       VALUES (?, ?, ?, ?, 'user')`
    )
      .bind(defaultName, googleUser.email, crypto.randomUUID(), googleUser.sub)
      .run();

    user = await env.DB.prepare(
      `SELECT id, name, email, google_sub, role, bio, theme_mode, font_size_scale, locale
       FROM users WHERE email = ?`
    )
      .bind(googleUser.email)
      .first();
  } else if (!user.google_sub) {
    await env.DB.prepare('UPDATE users SET google_sub = ? WHERE id = ?')
      .bind(googleUser.sub, user.id)
      .run();
    user.google_sub = googleUser.sub;
  } else if (user.google_sub !== googleUser.sub) {
    return jsonResponse({ error: 'Google account mismatch' }, 401, request);
  }

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
