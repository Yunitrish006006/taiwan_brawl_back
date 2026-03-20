import { getCurrentUser, jsonResponse } from './utils.js';

export async function handleGetCurrentUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }
  return jsonResponse({ user }, 200, request);
}

export async function handleUpdateCurrentUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ error: 'Invalid body' }, 400, request);
  }

  const allowed = ['name', 'bio'];
  const updates = [];
  const values = [];

  for (const field of allowed) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) {
    return jsonResponse({ error: 'No valid fields to update' }, 400, request);
  }

  values.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(...values)
    .run();

  return jsonResponse({ ok: true }, 200, request);
}

export async function handleUpdateThemeMode(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const mode = body?.theme_mode;
  const validModes = ['light', 'dark', 'system'];
  if (!validModes.includes(mode)) {
    return jsonResponse({ error: 'Invalid theme mode' }, 400, request);
  }

  await env.DB.prepare('UPDATE users SET theme_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(mode, user.id)
    .run();

  return jsonResponse({ ok: true }, 200, request);
}

export async function handleUpdateUiPreferences(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const scale = Number(body?.font_size_scale);
  if (!Number.isFinite(scale) || scale < 0.8 || scale > 1.6) {
    return jsonResponse({ error: 'font_size_scale must be between 0.8 and 1.6' }, 400, request);
  }

  await env.DB.prepare('UPDATE users SET font_size_scale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(scale, user.id)
    .run();

  return jsonResponse({ ok: true }, 200, request);
}
