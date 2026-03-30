import { getCurrentUser, jsonResponse, mapUserRow } from './utils.js';

function allowedImageContentType(contentType) {
  const normalized = String(contentType ?? '').trim().toLowerCase();
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
    normalized
  )
    ? normalized
    : null;
}

function decodeBase64(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildUploadedAvatarUrl(userId, uploadedAvatarVersion) {
  const version = Number(uploadedAvatarVersion || 0);
  if (version <= 0) {
    return null;
  }
  return `/user-avatars/${encodeURIComponent(userId)}?v=${version}`;
}

function resolveAvatarUrlForSource({
  avatarSource,
  googleAvatarUrl,
  customAvatarUrl,
  uploadedAvatarUrl
}) {
  if (avatarSource === 'custom') {
    return customAvatarUrl ?? uploadedAvatarUrl ?? googleAvatarUrl ?? null;
  }
  if (avatarSource === 'upload') {
    return uploadedAvatarUrl ?? googleAvatarUrl ?? customAvatarUrl ?? null;
  }
  return googleAvatarUrl ?? uploadedAvatarUrl ?? customAvatarUrl ?? null;
}

async function fetchUserRow(env, userId) {
  const row = await env.DB.prepare(
    `SELECT id, name, email, role, bio, avatar_url, google_avatar_url,
            custom_avatar_url, avatar_source, uploaded_avatar_version,
            last_active_at, theme_mode, font_size_scale, locale
     FROM users
     WHERE id = ?`
  )
    .bind(userId)
    .first();
  return mapUserRow(row);
}

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
  const validAvatarSources = ['google', 'custom', 'upload'];
  if (!validAvatarSources.includes(nextAvatarSource)) {
    return jsonResponse(
      { error: 'avatar_source must be google, custom, or upload' },
      400,
      request
    );
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

  const nextCustomAvatarUrl = customAvatarInput.length === 0 ? null : customAvatarInput;
  const googleAvatarUrl = user.google_avatar_url ?? null;
  const uploadedAvatarUrl = buildUploadedAvatarUrl(
    user.id,
    user.uploaded_avatar_version
  );
  if (nextAvatarSource === 'google' && !googleAvatarUrl) {
    return jsonResponse({ error: 'No Google avatar available' }, 400, request);
  }
  if (nextAvatarSource === 'custom' && !nextCustomAvatarUrl) {
    return jsonResponse({ error: 'Custom avatar URL is required' }, 400, request);
  }
  if (nextAvatarSource === 'upload' && !uploadedAvatarUrl) {
    return jsonResponse({ error: 'Uploaded avatar image is required' }, 400, request);
  }

  const effectiveAvatarUrl = resolveAvatarUrlForSource({
    avatarSource: nextAvatarSource,
    googleAvatarUrl,
    customAvatarUrl: nextCustomAvatarUrl,
    uploadedAvatarUrl
  });

  const normalizedBio = nextBio.trim();
  await env.DB.prepare(
    `UPDATE users
     SET name = ?, bio = ?, custom_avatar_url = ?, avatar_source = ?,
         avatar_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      nextName.trim(),
      normalizedBio.length === 0 ? null : normalizedBio,
      nextCustomAvatarUrl,
      nextAvatarSource,
      effectiveAvatarUrl,
      user.id
    )
    .run();

  return jsonResponse({ ok: true }, 200, request);
}

export async function handleUploadAvatarImage(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const contentType = allowedImageContentType(body?.contentType);
  if (!contentType) {
    return jsonResponse(
      { error: 'Only PNG, JPEG, WEBP, and GIF images are supported' },
      400,
      request
    );
  }

  const bytes = decodeBase64(body?.bytesBase64);
  if (!bytes || !bytes.length) {
    return jsonResponse({ error: 'Image data is required' }, 400, request);
  }
  if (bytes.length > 1024 * 1024) {
    return jsonResponse({ error: 'Image must be 1 MB or smaller' }, 400, request);
  }

  const imageKey = `user-avatar:${user.id}`;
  const metaKey = `user-avatar-meta:${user.id}`;
  await env.STATIC_ASSETS.put(imageKey, bytes);
  await env.STATIC_ASSETS.put(
    metaKey,
    JSON.stringify({
      contentType,
      uploadedAt: new Date().toISOString()
    })
  );

  const uploadedAvatarVersion = Date.now();
  const uploadedAvatarUrl = buildUploadedAvatarUrl(user.id, uploadedAvatarVersion);
  const effectiveAvatarUrl = resolveAvatarUrlForSource({
    avatarSource: user.avatar_source === 'upload' ? 'upload' : user.avatar_source,
    googleAvatarUrl: user.google_avatar_url ?? null,
    customAvatarUrl: user.custom_avatar_url ?? null,
    uploadedAvatarUrl
  });

  await env.DB.prepare(
    `UPDATE users
     SET uploaded_avatar_version = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(uploadedAvatarVersion, effectiveAvatarUrl, user.id)
    .run();

  const nextUser = await fetchUserRow(env, user.id);
  return jsonResponse({ ok: true, user: nextUser }, 200, request);
}

export async function handleDeleteAvatarImage(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  await env.STATIC_ASSETS?.delete?.(`user-avatar:${user.id}`);
  await env.STATIC_ASSETS?.delete?.(`user-avatar-meta:${user.id}`);

  const fallbackSource =
    user.avatar_source === 'upload'
      ? user.google_avatar_url
        ? 'google'
        : user.custom_avatar_url
          ? 'custom'
          : 'google'
      : user.avatar_source;
  const effectiveAvatarUrl = resolveAvatarUrlForSource({
    avatarSource: fallbackSource,
    googleAvatarUrl: user.google_avatar_url ?? null,
    customAvatarUrl: user.custom_avatar_url ?? null,
    uploadedAvatarUrl: null
  });

  await env.DB.prepare(
    `UPDATE users
     SET uploaded_avatar_version = 0, avatar_source = ?, avatar_url = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(fallbackSource, effectiveAvatarUrl, user.id)
    .run();

  const nextUser = await fetchUserRow(env, user.id);
  return jsonResponse({ ok: true, user: nextUser }, 200, request);
}

export async function getUserAvatarImageResponse(env, userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const imageKey = `user-avatar:${normalizedUserId}`;
  const metaKey = `user-avatar-meta:${normalizedUserId}`;
  const [bytes, metaRaw] = await Promise.all([
    env.STATIC_ASSETS.get(imageKey, 'arrayBuffer'),
    env.STATIC_ASSETS.get(metaKey)
  ]);
  if (!bytes) {
    return null;
  }

  let contentType = 'application/octet-stream';
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      if (typeof meta?.contentType === 'string' && meta.contentType) {
        contentType = meta.contentType;
      }
    } catch (_) {
      // ignore invalid metadata and serve with fallback content type
    }
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
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
