import {
  buildUploadedAvatarUrl,
  fetchMappedUserById,
  getCurrentUser,
  jsonResponse,
  resolveAvatarUrlForSource
} from '../core/utils.js';
import {
  buildLlmBotSettingsSnapshot,
  normalizeLlmBotBaseUrl,
  normalizeLlmBotModel
} from '../royale/royale_llm_bot.js';

const VALID_AVATAR_SOURCES = ['google', 'custom', 'upload'];
const VALID_LOCALES = ['zh-Hant', 'en', 'ja'];
const VALID_THEME_MODES = ['light', 'dark', 'system'];
const MAX_UPLOADED_AVATAR_BYTES = 1024 * 1024;

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

async function fetchUserRow(env, userId) {
  return fetchMappedUserById(env, userId);
}

async function withCurrentUser(request, env, handler) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }
  return handler(user);
}

function uploadedAvatarImageKey(userId) {
  return `user-avatar:${userId}`;
}

function uploadedAvatarMetaKey(userId) {
  return `user-avatar-meta:${userId}`;
}

function uploadedAvatarUrlFor(userId, uploadedAvatarVersion) {
  return buildUploadedAvatarUrl(userId, uploadedAvatarVersion);
}

function resolveEffectiveAvatarUrl(user, {
  avatarSource = user.avatar_source,
  customAvatarUrl = user.custom_avatar_url ?? null,
  uploadedAvatarVersion = user.uploaded_avatar_version ?? 0,
  uploadedAvatarUrl
} = {}) {
  return resolveAvatarUrlForSource({
    avatarSource,
    googleAvatarUrl: user.google_avatar_url ?? null,
    customAvatarUrl,
    uploadedAvatarUrl:
      uploadedAvatarUrl ??
      uploadedAvatarUrlFor(user.id, uploadedAvatarVersion),
    fallbackAvatarUrl: user.avatar_url ?? null
  });
}

function validateAvatarSource(avatarSource, request) {
  if (VALID_AVATAR_SOURCES.includes(avatarSource)) {
    return null;
  }
  return jsonResponse(
    { error: 'avatar_source must be google, custom, or upload' },
    400,
    request
  );
}

function normalizeCustomAvatarUrl(value, request) {
  const normalized = String(value ?? '').trim();
  if (
    normalized !== '' &&
    !normalized.startsWith('https://') &&
    !normalized.startsWith('http://')
  ) {
    return {
      error: jsonResponse(
        { error: 'custom_avatar_url must start with http:// or https://' },
        400,
        request
      )
    };
  }

  return { value: normalized.length === 0 ? null : normalized };
}

export async function handleUpdateLocale(request, env) {
  return withCurrentUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const locale = body?.locale;
    if (!VALID_LOCALES.includes(locale)) {
      return jsonResponse({ error: 'Invalid locale' }, 400, request);
    }
    await env.DB.prepare('UPDATE users SET locale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(locale, user.id)
      .run();
    return jsonResponse({ ok: true }, 200, request);
  });
}

export async function handleGetCurrentUser(request, env) {
  return withCurrentUser(request, env, async (user) => {
    return jsonResponse({ user }, 200, request);
  });
}

export async function handleUpdateCurrentUser(request, env) {
  return withCurrentUser(request, env, async (user) => {
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
    const avatarSourceError = validateAvatarSource(nextAvatarSource, request);
    if (avatarSourceError) {
      return avatarSourceError;
    }

    const customAvatarResult = normalizeCustomAvatarUrl(
      body.custom_avatar_url !== undefined
        ? body.custom_avatar_url
        : (user.custom_avatar_url ?? ''),
      request
    );
    if (customAvatarResult.error) {
      return customAvatarResult.error;
    }

    const nextCustomAvatarUrl = customAvatarResult.value;
    const uploadedAvatarUrl = uploadedAvatarUrlFor(
      user.id,
      user.uploaded_avatar_version
    );
    if (nextAvatarSource === 'google' && !user.google_avatar_url) {
      return jsonResponse({ error: 'No Google avatar available' }, 400, request);
    }
    if (nextAvatarSource === 'custom' && !nextCustomAvatarUrl) {
      return jsonResponse({ error: 'Custom avatar URL is required' }, 400, request);
    }
    if (nextAvatarSource === 'upload' && !uploadedAvatarUrl) {
      return jsonResponse({ error: 'Uploaded avatar image is required' }, 400, request);
    }

    const normalizedBio = nextBio.trim();
    const effectiveAvatarUrl = resolveEffectiveAvatarUrl(user, {
      avatarSource: nextAvatarSource,
      customAvatarUrl: nextCustomAvatarUrl,
      uploadedAvatarUrl
    });

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
  });
}

export async function handleUploadAvatarImage(request, env) {
  return withCurrentUser(request, env, async (user) => {
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
    if (bytes.length > MAX_UPLOADED_AVATAR_BYTES) {
      return jsonResponse({ error: 'Image must be 1 MB or smaller' }, 400, request);
    }

    await env.STATIC_ASSETS.put(uploadedAvatarImageKey(user.id), bytes);
    await env.STATIC_ASSETS.put(
      uploadedAvatarMetaKey(user.id),
      JSON.stringify({
        contentType,
        uploadedAt: new Date().toISOString()
      })
    );

    const uploadedAvatarVersion = Date.now();
    const effectiveAvatarUrl = resolveEffectiveAvatarUrl(user, {
      avatarSource: user.avatar_source === 'upload' ? 'upload' : user.avatar_source,
      uploadedAvatarVersion
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
  });
}

export async function handleDeleteAvatarImage(request, env) {
  return withCurrentUser(request, env, async (user) => {
    await env.STATIC_ASSETS?.delete?.(uploadedAvatarImageKey(user.id));
    await env.STATIC_ASSETS?.delete?.(uploadedAvatarMetaKey(user.id));

    const fallbackSource =
      user.avatar_source === 'upload'
        ? user.google_avatar_url
          ? 'google'
          : user.custom_avatar_url
            ? 'custom'
            : 'google'
        : user.avatar_source;
    const effectiveAvatarUrl = resolveEffectiveAvatarUrl(user, {
      avatarSource: fallbackSource,
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
  });
}

export async function getUserAvatarImageResponse(env, userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const imageKey = uploadedAvatarImageKey(normalizedUserId);
  const metaKey = uploadedAvatarMetaKey(normalizedUserId);
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
  return withCurrentUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const mode = body?.theme_mode;
    if (!VALID_THEME_MODES.includes(mode)) {
      return jsonResponse({ error: 'Invalid theme mode' }, 400, request);
    }

    await env.DB.prepare('UPDATE users SET theme_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(mode, user.id)
      .run();

    return jsonResponse({ ok: true }, 200, request);
  });
}

export async function handleUpdateUiPreferences(request, env) {
  return withCurrentUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    const scale = Number(body?.font_size_scale);
    if (!Number.isFinite(scale) || scale < 0.8 || scale > 1.6) {
      return jsonResponse({ error: 'font_size_scale must be between 0.8 and 1.6' }, 400, request);
    }

    await env.DB.prepare('UPDATE users SET font_size_scale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(scale, user.id)
      .run();

    return jsonResponse({ ok: true }, 200, request);
  });
}

export async function handleUpdateLlmBotSettings(request, env) {
  return withCurrentUser(request, env, async (user) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid body' }, 400, request);
    }

    const baseUrl = normalizeLlmBotBaseUrl(
      body.base_url !== undefined ? body.base_url : user.llm_base_url
    );
    const model = normalizeLlmBotModel(
      body.model !== undefined ? body.model : user.llm_model
    );

    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
      return jsonResponse({ error: 'base_url must start with http:// or https://' }, 400, request);
    }
    if (!model.trim()) {
      return jsonResponse({ error: 'model is required' }, 400, request);
    }

    let nextApiKey = undefined;
    if (body.api_key !== undefined) {
      const normalizedApiKey = String(body.api_key ?? '').trim();
      nextApiKey = normalizedApiKey.length === 0 ? null : normalizedApiKey;
    }

    await env.DB.prepare(
      `UPDATE users
       SET llm_base_url = ?, llm_model = ?,
           llm_api_key = COALESCE(?, llm_api_key),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(baseUrl, model, nextApiKey, user.id)
      .run();

    if (body.api_key !== undefined && String(body.api_key ?? '').trim().length === 0) {
      await env.DB.prepare(
        `UPDATE users
         SET llm_api_key = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(user.id)
        .run();
    }

    return jsonResponse(
      {
        ok: true,
        settings: buildLlmBotSettingsSnapshot({
          llm_base_url: baseUrl,
          llm_model: model,
          llm_api_key:
            nextApiKey === undefined
              ? user.llm_has_api_key
                ? 'configured'
                : null
              : nextApiKey
        })
      },
      200,
      request
    );
  });
}
