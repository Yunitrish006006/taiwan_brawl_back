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

export async function getCurrentUser(request, env) {
  const sessionId = parseSessionId(request);
  if (!sessionId) return null;

  const session = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first();

  if (!session || new Date(session.expires_at) < new Date()) {
    return null;
  }

  return env.DB.prepare(
    `SELECT id, name, email, role, bio, theme_mode, font_size_scale
     FROM users
     WHERE id = ?`
  )
    .bind(session.user_id)
    .first();
}
