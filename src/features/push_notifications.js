import { jsonResponse } from '../core/utils.js';

const VALID_PUSH_PLATFORMS = ['android', 'ios', 'macos', 'web'];
const FCM_INVALID_ERROR_CODES = new Set([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'REGISTRATION_TOKEN_NOT_REGISTERED',
  'UNREGISTERED',
]);
const FCM_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Push retry configuration
const PUSH_RETRY_MAX_ATTEMPTS = 3;
const PUSH_RETRY_DELAYS_MS = [30_000, 120_000, 600_000]; // 30s, 2min, 10min
const PUSH_RETRY_KV_PREFIX = 'push_retry:';

function pushRetryKey(receiverId, notificationId) {
  return `${PUSH_RETRY_KV_PREFIX}${receiverId}:${notificationId}`;
}

function shouldRetryPush(attemptCount, maxAttempts = PUSH_RETRY_MAX_ATTEMPTS) {
  return attemptCount < maxAttempts;
}

function nextRetryDelayMs(attemptCount) {
  const index = Math.max(0, Math.min(attemptCount - 1, PUSH_RETRY_DELAYS_MS.length - 1));
  return PUSH_RETRY_DELAYS_MS[index];
}

function nowMs() {
  return Date.now();
}

function trimString(value) {
  return String(value ?? '').trim();
}

function normalizeLocale(value) {
  const normalized = trimString(value).toLowerCase();
  if (normalized.startsWith('zh')) {
    return 'zh-Hant';
  }
  if (normalized.startsWith('ja')) {
    return 'ja';
  }
  if (normalized.startsWith('en')) {
    return 'en';
  }
  return 'zh-Hant';
}

function normalizePlatform(value) {
  const normalized = trimString(value).toLowerCase();
  return VALID_PUSH_PLATFORMS.includes(normalized) ? normalized : null;
}

function normalizeOptionalText(value, maxLength = 255) {
  const normalized = trimString(value);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizePrivateKey(value) {
  const normalized = trimString(value);
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\\n/g, '\n');
}

function createBadRequest(message, request) {
  return { error: jsonResponse({ error: message }, 400, request) };
}

function configuredPlatforms(env) {
  if (!hasFcmClientConfig(env) || !hasFcmDeliveryConfig(env)) {
    return [];
  }

  return [
    'android',
    'ios',
    'macos',
    ...(trimString(env.FCM_WEB_VAPID_KEY) ? ['web'] : []),
  ];
}

export function hasFcmClientConfig(env) {
  return Boolean(
    trimString(env.FCM_PROJECT_ID) &&
      trimString(env.FCM_API_KEY) &&
      trimString(env.FCM_APP_ID) &&
      trimString(env.FCM_MESSAGING_SENDER_ID)
  );
}

export function hasFcmDeliveryConfig(env) {
  return Boolean(
    trimString(env.FCM_PROJECT_ID) &&
      trimString(env.FCM_CLIENT_EMAIL) &&
      normalizePrivateKey(env.FCM_PRIVATE_KEY)
  );
}

export function buildPublicPushConfig(env) {
  const deliveryEnabled = hasFcmDeliveryConfig(env);
  const clientEnabled = hasFcmClientConfig(env);
  const enabledPlatforms = configuredPlatforms(env);
  const fcmEnabled = clientEnabled && deliveryEnabled && enabledPlatforms.length > 0;

  return {
    enabled: fcmEnabled,
    deliveryEnabled,
    provider: 'fcm',
    enabledPlatforms,
    fcm: {
      enabled: fcmEnabled,
      projectId: clientEnabled ? trimString(env.FCM_PROJECT_ID) : null,
      apiKey: clientEnabled ? trimString(env.FCM_API_KEY) : null,
      appId: clientEnabled ? trimString(env.FCM_APP_ID) : null,
      messagingSenderId: clientEnabled ? trimString(env.FCM_MESSAGING_SENDER_ID) : null,
      authDomain: normalizeOptionalText(env.FCM_AUTH_DOMAIN),
      storageBucket: normalizeOptionalText(env.FCM_STORAGE_BUCKET),
      measurementId: normalizeOptionalText(env.FCM_MEASUREMENT_ID),
      iosBundleId: normalizeOptionalText(env.FCM_IOS_BUNDLE_ID),
      webVapidKey: normalizeOptionalText(env.FCM_WEB_VAPID_KEY, 512),
      serviceWorkerPath: '/firebase-messaging-sw.js',
    },
  };
}

export function validatePushRequestBody(request, body, options = {}) {
  const {
    requireInstallationId = true,
    requirePlatform = true,
    requireRegistrationFields = true,
  } = options;

  const installationId = trimString(body?.installationId);
  if (requireInstallationId && !installationId) {
    return createBadRequest('installationId is required', request);
  }

  const platform = normalizePlatform(body?.platform);
  if (requirePlatform && !platform) {
    return createBadRequest('platform must be android, ios, macos, or web', request);
  }

  if (!platform || !requireRegistrationFields) {
    return {};
  }

  const provider = trimString(body?.provider || 'fcm').toLowerCase();
  if (provider !== 'fcm') {
    return createBadRequest('provider must be fcm', request);
  }

  const token = trimString(body?.token);
  if (token.length < 32) {
    return createBadRequest('token is required for fcm', request);
  }

  return {};
}

export async function registerPushDevice(userId, body, env) {
  const installationId = trimString(body?.installationId);
  const platform = normalizePlatform(body?.platform);
  const token = trimString(body?.token);
  if (!installationId || !platform || token.length < 32) {
    throw new Error('installationId, platform, and token are required');
  }

  const locale = normalizeLocale(body?.locale);
  const deviceName = normalizeOptionalText(body?.deviceName);
  const appVersion = normalizeOptionalText(body?.appVersion, 64);
  const userAgent = normalizeOptionalText(body?.userAgent, 512);

  await env.DB.prepare(
    'DELETE FROM push_registrations WHERE push_token = ?1 AND installation_id != ?2'
  )
    .bind(token, installationId)
    .run();

  await env.DB.prepare(
    `INSERT INTO push_registrations (
      user_id,
      installation_id,
      platform,
      provider,
      push_token,
      device_name,
      locale,
      app_version,
      user_agent,
      updated_at,
      last_seen_at,
      invalidated_at,
      last_error_code,
      last_error_at
    ) VALUES (?1, ?2, ?3, 'fcm', ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, NULL)
    ON CONFLICT(installation_id, platform) DO UPDATE SET
      user_id = excluded.user_id,
      provider = excluded.provider,
      push_token = excluded.push_token,
      device_name = excluded.device_name,
      locale = excluded.locale,
      app_version = excluded.app_version,
      user_agent = excluded.user_agent,
      updated_at = CURRENT_TIMESTAMP,
      last_seen_at = CURRENT_TIMESTAMP,
      invalidated_at = NULL,
      last_error_code = NULL,
      last_error_at = NULL`
  )
    .bind(userId, installationId, platform, token, deviceName, locale, appVersion, userAgent)
    .run();
}

export async function unregisterPushDevice(body, env) {
  const installationId = trimString(body?.installationId);
  const platform = normalizePlatform(body?.platform);
  if (!installationId || !platform) {
    throw new Error('installationId and platform are required');
  }

  await env.DB.prepare(
    'DELETE FROM push_registrations WHERE installation_id = ?1 AND platform = ?2'
  )
    .bind(installationId, platform)
    .run();
}

async function listActivePushRegistrations(userId, env) {
  const rows = await env.DB.prepare(
    `SELECT id, installation_id, platform, provider, push_token, locale
     FROM push_registrations
     WHERE user_id = ?1
       AND provider = 'fcm'
       AND invalidated_at IS NULL
     ORDER BY updated_at DESC`
  )
    .bind(userId)
    .all();

  return rows.results ?? [];
}

export function localizedChatText({ locale, senderName, text, kind }) {
  const effectiveLocale = normalizeLocale(locale);
  const safeSenderName = trimString(senderName) || '鬼島亂鬥';

  if (kind === 'recall') {
    if (effectiveLocale === 'ja') {
      return { title: safeSenderName, body: 'メッセージを取り消しました' };
    }
    if (effectiveLocale === 'en') {
      return { title: safeSenderName, body: 'Recalled a message' };
    }
    return { title: safeSenderName, body: '收回了一則訊息' };
  }

  if (effectiveLocale === 'ja') {
    return { title: safeSenderName, body: trimString(text) || '新しいメッセージ' };
  }
  if (effectiveLocale === 'en') {
    return { title: safeSenderName, body: trimString(text) || 'New message' };
  }
  return { title: safeSenderName, body: trimString(text) || '新訊息' };
}

export function buildPushNotificationId(
  randomUuid = () => crypto.randomUUID()
) {
  const normalized = trimString(randomUuid()).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized) {
    return normalized.slice(0, 32);
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function importServiceAccountPrivateKey(pem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function createFcmServiceAccountJwt(env) {
  const clientEmail = trimString(env.FCM_CLIENT_EMAIL);
  const privateKeyPem = normalizePrivateKey(env.FCM_PRIVATE_KEY);
  if (!clientEmail || !privateKeyPem) {
    throw new Error('FCM delivery is not configured');
  }

  const key = await importServiceAccountPrivateKey(privateKeyPem);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const unsignedToken =
    `${base64UrlEncodeJson({ alg: 'RS256', typ: 'JWT' })}.` +
    `${base64UrlEncodeJson({
      iss: clientEmail,
      scope: FCM_MESSAGING_SCOPE,
      aud: FCM_OAUTH_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );
  return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function createFcmAccessToken(env) {
  const assertion = await createFcmServiceAccountJwt(env);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(FCM_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = trimString(payload?.error_description || payload?.error) || `HTTP_${response.status}`;
    throw new Error(`FCM OAuth failed: ${reason}`);
  }

  const token = trimString(payload?.access_token);
  if (!token) {
    throw new Error('FCM OAuth response did not include access_token');
  }
  return token;
}

async function invalidatePushRegistration(id, errorCode, env) {
  await env.DB.prepare(
    `UPDATE push_registrations
     SET invalidated_at = CURRENT_TIMESTAMP,
         last_error_code = ?2,
         last_error_at = CURRENT_TIMESTAMP
     WHERE id = ?1`
  )
    .bind(id, normalizeOptionalText(errorCode, 64) || 'unknown')
    .run();
}

async function markPushRegistrationError(id, errorCode, env) {
  await env.DB.prepare(
    `UPDATE push_registrations
     SET last_error_code = ?2,
         last_error_at = CURRENT_TIMESTAMP
     WHERE id = ?1`
  )
    .bind(id, normalizeOptionalText(errorCode, 64) || 'unknown')
    .run();
}

function fcmSendUrl(env) {
  return `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
    trimString(env.FCM_PROJECT_ID)
  )}/messages:send`;
}

function buildMessageData(messagePayload) {
  const conversationUserId = String(messagePayload.conversationUserId);
  const senderId = String(messagePayload.senderId);
  return {
    type: trimString(messagePayload.type),
    notificationId: trimString(messagePayload.notificationId),
    conversationUserId,
    senderId,
    url: `${messagePayload.appOrigin}/?conversationUserId=${encodeURIComponent(conversationUserId)}`,
  };
}

export function buildFcmMessage(registration, messagePayload) {
  const data = buildMessageData(messagePayload);
  const tag = `${messagePayload.type}-${messagePayload.notificationId}`;

  return {
    token: trimString(registration.push_token),
    notification: {
      title: messagePayload.title,
      body: messagePayload.body,
    },
    data,
    android: {
      priority: 'HIGH',
      notification: {
        tag,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          alert: {
            title: messagePayload.title,
            body: messagePayload.body,
          },
          sound: 'default',
          'thread-id': `dm-${data.conversationUserId}`,
        },
      },
    },
    webpush: {
      headers: {
        TTL: '60',
        Urgency: 'high',
        Topic: messagePayload.notificationId,
      },
      notification: {
        title: messagePayload.title,
        body: messagePayload.body,
        icon: '/icons/Icon-192.png',
        badge: '/icons/Icon-192.png',
        tag,
        data,
      },
      fcm_options: {
        link: data.url,
      },
    },
  };
}

function fcmErrorCode(errorPayload) {
  const status = trimString(errorPayload?.error?.status).toUpperCase();
  const details = Array.isArray(errorPayload?.error?.details)
    ? errorPayload.error.details
    : [];
  for (const detail of details) {
    const code = trimString(detail?.errorCode).toUpperCase();
    if (code) {
      return code;
    }
  }
  return status;
}

export function shouldInvalidateFcmToken(status, errorCode) {
  const normalized = trimString(errorCode).toUpperCase();
  return status === 404 || FCM_INVALID_ERROR_CODES.has(normalized);
}

function isPermanentFcmFailure(result) {
  return shouldInvalidateFcmToken(result?.status, result?.reason);
}

async function sendFcmNotification(env, registration, messagePayload, accessToken) {
  if (!hasFcmDeliveryConfig(env)) {
    return { skipped: true };
  }
  if (!accessToken) {
    return { ok: false, reason: 'NO_AUTH_TOKEN' };
  }

  const response = await fetch(fcmSendUrl(env), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      message: buildFcmMessage(registration, messagePayload),
    }),
  });

  if (response.ok) {
    return { ok: true };
  }

  const errorPayload = await response.json().catch(() => null);
  const reason =
    fcmErrorCode(errorPayload) ||
    trimString(errorPayload?.error?.message) ||
    `HTTP_${response.status}`;
  if (shouldInvalidateFcmToken(response.status, reason)) {
    await invalidatePushRegistration(registration.id, reason, env);
  } else {
    await markPushRegistrationError(registration.id, reason, env);
  }

  return { ok: false, status: response.status, reason };
}

export async function sendDirectMessagePush(
  env,
  { senderId, senderName, receiverId, text, kind, appOrigin }
) {
  const registrations = await listActivePushRegistrations(receiverId, env);
  if (!registrations.length) {
    return;
  }

  const accessToken = await createFcmAccessToken(env).catch(() => null);
  const results = await Promise.allSettled(
    registrations.map(async (registration) => {
      const notificationId = buildPushNotificationId();
      const messageText = localizedChatText({
        locale: registration.locale,
        senderName,
        text,
        kind,
      });
      const messagePayload = {
        ...messageText,
        type: kind === 'recall' ? 'dm_recall' : 'dm_message',
        notificationId,
        conversationUserId: senderId,
        senderId,
        appOrigin,
      };

      return sendFcmNotification(env, registration, messagePayload, accessToken);
    })
  );

  const failedRegistrations = registrations.filter((reg, index) => {
    const result = results[index];
    return result?.status === 'rejected' || (result?.value && result.value.ok === false);
  });

  for (let i = 0; i < failedRegistrations.length; i++) {
    const registration = failedRegistrations[i];
    const result = results[registrations.indexOf(registration)];
    const pushResult = result?.value || { ok: false, reason: 'UNKNOWN' };

    if (isPermanentFcmFailure(pushResult)) {
      continue;
    }

    const notificationId = buildPushNotificationId();
    const retryPayload = {
      receiverId,
      senderId,
      senderName,
      text,
      kind,
      appOrigin,
      attemptCount: 0,
      registeredAt: nowMs(),
      provider: 'fcm',
      registrationId: registration.id,
    };

    try {
      await env.PUSH_RETRY?.put?.(
        pushRetryKey(receiverId, notificationId),
        JSON.stringify(retryPayload),
        { expirationTtl: 3600 }
      );
    } catch (_) {
      // KV not available, skip retry.
    }
  }
}

/**
 * Process push notification retries from KV.
 * Should be called periodically by a scheduled handler.
 * @param {*} env
 */
export async function processPushRetries(env) {
  if (!env.PUSH_RETRY) {
    return { processed: 0, skipped: 0 };
  }

  const listResult = await env.PUSH_RETRY.list({ prefix: PUSH_RETRY_KV_PREFIX });
  let processedCount = 0;
  let skippedCount = 0;
  const accessToken = await createFcmAccessToken(env).catch(() => null);

  for (const key of (listResult.keys || [])) {
    let payload;
    try {
      const raw = await env.PUSH_RETRY.get(key.name);
      if (!raw) {
        await env.PUSH_RETRY.delete(key.name);
        skippedCount += 1;
        continue;
      }
      payload = JSON.parse(raw);
    } catch (_) {
      await env.PUSH_RETRY.delete(key.name);
      skippedCount += 1;
      continue;
    }

    const {
      receiverId,
      senderId,
      senderName,
      text,
      kind,
      appOrigin,
      attemptCount,
      provider,
      registrationId,
    } = payload;
    const currentAttempt = Number(attemptCount || 0);

    if (provider && provider !== 'fcm') {
      await env.PUSH_RETRY.delete(key.name);
      skippedCount += 1;
      continue;
    }

    if (!shouldRetryPush(currentAttempt)) {
      await env.PUSH_RETRY.delete(key.name);
      skippedCount += 1;
      continue;
    }

    const registrations = await listActivePushRegistrations(receiverId, env);
    const registration = registrations.find((r) => r.id === registrationId);
    if (!registration) {
      await env.PUSH_RETRY.delete(key.name);
      skippedCount += 1;
      continue;
    }

    const messageText = localizedChatText({
      locale: registration.locale,
      senderName,
      text,
      kind,
    });

    const notificationId = key.name.split(':')[2] || buildPushNotificationId();
    const messagePayload = {
      ...messageText,
      type: kind === 'recall' ? 'dm_recall' : 'dm_message',
      notificationId,
      conversationUserId: senderId,
      senderId,
      appOrigin,
    };

    const pushResult = await sendFcmNotification(
      env,
      registration,
      messagePayload,
      accessToken
    );

    processedCount += 1;

    if (pushResult.ok) {
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    if (isPermanentFcmFailure(pushResult) || !shouldRetryPush(currentAttempt + 1)) {
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    const nextAttempt = currentAttempt + 1;
    const updatedPayload = {
      ...payload,
      provider: 'fcm',
      attemptCount: nextAttempt,
      nextAttemptAfter: nowMs() + nextRetryDelayMs(nextAttempt),
      lastAttemptAt: nowMs(),
      lastError: pushResult.reason || `HTTP_${pushResult.status}`,
    };

    await env.PUSH_RETRY.put(key.name, JSON.stringify(updatedPayload), {
      expirationTtl: 3600,
    });
  }

  return { processed: processedCount, skipped: skippedCount };
}

export const __testables = {
  buildFcmMessage,
  buildPublicPushConfig,
  buildPushNotificationId,
  hasFcmClientConfig,
  hasFcmDeliveryConfig,
  localizedChatText,
  shouldInvalidateFcmToken,
  validatePushRequestBody,
};
