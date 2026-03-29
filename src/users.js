
import { getCurrentUser, jsonResponse } from './utils.js';

export async function handleUpdateLocale(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }
  const body = await request.json().catch(() => null);
  const locale = body?.locale;
  // 可支援 zh-Hant, en, ja
  const validLocales = ['zh-Hant', 'en', 'ja'];
  if (!validLocales.includes(locale)) {
    return jsonResponse({ error: 'Invalid locale' }, 400, request);
  }
  await env.DB.prepare('UPDATE users SET locale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(locale, user.id)
    .run();
  return jsonResponse({ ok: true }, 200, request);
}

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

  const nextName = body.name !== undefined ? String(body.name) : user.name;
  const nextBio = body.bio !== undefined ? String(body.bio) : (user.bio ?? '');
  const requestedAvatarSource = body.avatar_source;
  const nextAvatarSource =
    requestedAvatarSource === undefined
      ? user.avatar_source
      : String(requestedAvatarSource).trim();
  const validAvatarSources = ['google', 'custom'];
  if (!validAvatarSources.includes(nextAvatarSource)) {
    return jsonResponse({ error: 'avatar_source must be google or custom' }, 400, request);
  }

  const customAvatarInput =
    body.custom_avatar_url !== undefined
      ? String(body.custom_avatar_url ?? '').trim()
      : (user.custom_avatar_url ?? '');
  if (
    customAvatarInput !== '' &&
    !customAvatarInput.startsWith('https://') &&
    !customAvatarInput.startsWith('http://')
  ) {
    return jsonResponse(
      { error: 'custom_avatar_url must start with http:// or https://' },
      400,
      request
    );
  }

  const nextCustomAvatarUrl = customAvatarInput.isEmpty ? null : customAvatarInput;
  const googleAvatarUrl = user.google_avatar_url ?? null;
  if (nextAvatarSource === 'google' && !googleAvatarUrl) {
    return jsonResponse({ error: 'No Google avatar available' }, 400, request);
  }
  if (nextAvatarSource === 'custom' && !nextCustomAvatarUrl) {
    return jsonResponse({ error: 'Custom avatar URL is required' }, 400, request);
  }

  const effectiveAvatarUrl =
    nextAvatarSource === 'custom' ? nextCustomAvatarUrl : googleAvatarUrl;

  const normalizedBio = nextBio.trim();
  await env.DB.prepare(
    `UPDATE users
     SET name = ?, bio = ?, custom_avatar_url = ?, avatar_source = ?,
         avatar_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      nextName.trim(),
      normalizedBio.isEmpty ? null : normalizedBio,
      nextCustomAvatarUrl,
      nextAvatarSource,
      effectiveAvatarUrl,
      user.id
    )
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
