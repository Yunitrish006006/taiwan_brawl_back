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

async function fetchGoogleTokenInfo(idToken) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return jsonResponse({ error: 'Missing email or password' }, 400, request);
  }

  const user = await env.DB.prepare(
    `SELECT id, name, email, password, role, bio, theme_mode, font_size_scale
     FROM users WHERE email = ?`
  )
    .bind(body.email)
    .first();

  if (!user || user.password !== body.password) {
    return jsonResponse({ error: 'Invalid credentials' }, 401, request);
  }

  const sessionId = await createSession(user.id, env);
  return new Response(JSON.stringify({ ok: true, session_id: sessionId, user: { ...user, password: undefined } }), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie('session_id', sessionId, 30 * 24 * 3600)
    }
  });
}

export async function handleRegister(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.email || !body?.password) {
    return jsonResponse({ error: 'Missing fields' }, 400, request);
  }

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email)
    .first();
  if (exists) {
    return jsonResponse({ error: 'Email already exists' }, 409, request);
  }

  await env.DB.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .bind(body.name, body.email, body.password, 'user')
    .run();

  return jsonResponse({ ok: true }, 201, request);
}

export async function handleGoogleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.id_token) {
    return jsonResponse({ error: 'Missing id_token' }, 400, request);
  }

  const tokenInfo = await fetchGoogleTokenInfo(body.id_token);
  if (!tokenInfo?.sub || !tokenInfo?.email) {
    return jsonResponse({ error: 'Invalid Google token' }, 401, request);
  }

  let user = await env.DB.prepare(
    `SELECT id, name, email, role, bio, theme_mode, font_size_scale
     FROM users WHERE email = ?`
  )
    .bind(tokenInfo.email)
    .first();

  if (!user) {
    const defaultName = tokenInfo.name || tokenInfo.email.split('@')[0];
    await env.DB.prepare(
      `INSERT INTO users (name, email, password, google_sub, role)
       VALUES (?, ?, ?, ?, 'user')`
    )
      .bind(defaultName, tokenInfo.email, crypto.randomUUID(), tokenInfo.sub)
      .run();

    user = await env.DB.prepare(
      `SELECT id, name, email, role, bio, theme_mode, font_size_scale
       FROM users WHERE email = ?`
    )
      .bind(tokenInfo.email)
      .first();
  }

  const sessionId = await createSession(user.id, env);
  return new Response(JSON.stringify({ ok: true, session_id: sessionId, user }), {
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
