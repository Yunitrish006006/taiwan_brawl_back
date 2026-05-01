import webpush from 'web-push';

import { jsonResponse } from '../core/utils.js';

const VALID_PUSH_PLATFORMS = ['ios', 'web'];
const APNS_INVALID_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);
const WEB_PUSH_INVALID_STATUS_CODES = new Set([404, 410]);

// Push retry configuration
const PUSH_RETRY_MAX_ATTEMPTS = 3;
const PUSH_RETRY_DELAYS_MS = [30_000, 120_000, 600_000]; // 30s, 2min, 10min
const PUSH_RETRY_KV_PREFIX = 'push_retry:';
const PUSH_RETRY_LIST_KEY = 'push_retry_queue';

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

function retryMetadataKey(notificationId) {
  return `retry_meta:${notificationId}`;
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

export function hasApnsDeliveryConfig(env) {
  return Boolean(
    trimString(env.APNS_TEAM_ID) &&
      trimString(env.APNS_KEY_ID) &&
      normalizePrivateKey(env.APNS_PRIVATE_KEY) &&
      trimString(env.APNS_BUNDLE_ID)
  );
}

export function hasWebPushDeliveryConfig(env) {
  return Boolean(
    trimString(env.WEB_PUSH_PUBLIC_KEY) &&
      trimString(env.WEB_PUSH_PRIVATE_KEY) &&
      trimString(env.WEB_PUSH_SUBJECT)
  );
}

export function buildPublicPushConfig(env) {
  const iosEnabled = hasApnsDeliveryConfig(env);
  const webEnabled = hasWebPushDeliveryConfig(env);
  const enabledPlatforms = [
    ...(iosEnabled ? ['ios'] : []),
    ...(webEnabled ? ['web'] : []),
  ];

  return {
    enabled: enabledPlatforms.length > 0,
    deliveryEnabled: iosEnabled || webEnabled,
    enabledPlatforms,
    ios: {
      enabled: iosEnabled,
    },
    web: {
      enabled: webEnabled,
      publicKey: webEnabled ? trimString(env.WEB_PUSH_PUBLIC_KEY) : null,
      serviceWorkerPath: '/web-push-sw.js',
      serviceWorkerScope: '/push-notifications/',
    },
  };
}

function normalizedWebSubscription(body) {
  const raw = body?.subscription;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const endpoint = trimString(raw.endpoint);
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {};
  const p256dh = trimString(keys?.p256dh);
  const auth = trimString(keys?.auth);
  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    expirationTime: raw.expirationTime ?? null,
    keys: {
      p256dh,
      auth,
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
    return createBadRequest('platform must be ios or web', request);
  }

  if (!platform) {
    return {};
  }

  if (!requireRegistrationFields) {
    return {};
  }

  if (platform === 'ios') {
    const token = trimString(body?.token);
    if (token.length < 32) {
      return createBadRequest('token is required for ios', request);
    }
    return {};
  }

  if (!normalizedWebSubscription(body)) {
    return createBadRequest(
      'subscription with endpoint, p256dh, and auth is required for web',
      request
    );
  }

  return {};
}

export async function registerPushDevice(userId, body, env) {
  const installationId = trimString(body?.installationId);
  const platform = normalizePlatform(body?.platform);
  if (!installationId || !platform) {
    throw new Error('installationId and platform are required');
  }

  const locale = normalizeLocale(body?.locale);
  const deviceName = normalizeOptionalText(body?.deviceName);
  const appVersion = normalizeOptionalText(body?.appVersion, 64);
  const userAgent = normalizeOptionalText(body?.userAgent, 512);

  if (platform === 'ios') {
    const token = trimString(body?.token);
    if (token.length < 32) {
      throw new Error('token is required for ios');
    }

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
      ) VALUES (?1, ?2, 'ios', 'apns', ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, NULL)
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
      .bind(userId, installationId, token, deviceName, locale, appVersion, userAgent)
      .run();

    return;
  }

  const subscription = normalizedWebSubscription(body);
  if (!subscription) {
    throw new Error('valid web subscription is required');
  }

  await env.DB.prepare(
    'DELETE FROM push_registrations WHERE endpoint = ?1 AND installation_id != ?2'
  )
    .bind(subscription.endpoint, installationId)
    .run();

  await env.DB.prepare(
    `INSERT INTO push_registrations (
      user_id,
      installation_id,
      platform,
      provider,
      endpoint,
      subscription_json,
      p256dh_key,
      auth_key,
      device_name,
      locale,
      app_version,
      user_agent,
      updated_at,
      last_seen_at,
      invalidated_at,
      last_error_code,
      last_error_at
    ) VALUES (?1, ?2, 'web', 'webpush', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, NULL)
    ON CONFLICT(installation_id, platform) DO UPDATE SET
      user_id = excluded.user_id,
      provider = excluded.provider,
      endpoint = excluded.endpoint,
      subscription_json = excluded.subscription_json,
      p256dh_key = excluded.p256dh_key,
      auth_key = excluded.auth_key,
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
    .bind(
      userId,
      installationId,
      subscription.endpoint,
      JSON.stringify(subscription),
      subscription.keys.p256dh,
      subscription.keys.auth,
      deviceName,
      locale,
      appVersion,
      userAgent
    )
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
    `SELECT id, installation_id, platform, provider, push_token, endpoint, subscription_json, locale
     FROM push_registrations
     WHERE user_id = ?1
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

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32);
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

async function importApnsPrivateKey(pem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function createApnsAuthToken(env) {
  const teamId = trimString(env.APNS_TEAM_ID);
  const keyId = trimString(env.APNS_KEY_ID);
  const privateKeyPem = normalizePrivateKey(env.APNS_PRIVATE_KEY);
  if (!teamId || !keyId || !privateKeyPem) {
    throw new Error('APNs delivery is not configured');
  }

  const key = await importApnsPrivateKey(privateKeyPem);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const unsignedToken =
    `${base64UrlEncodeJson({ alg: 'ES256', kid: keyId })}.` +
    `${base64UrlEncodeJson({ iss: teamId, iat: nowSeconds })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken)
  );
  return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function apnsBaseUrl(env) {
  return trimString(env.APNS_USE_SANDBOX).toLowerCase() === 'true'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
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

export function shouldInvalidateApnsToken(status, reason) {
  return status === 410 || APNS_INVALID_REASONS.has(reason);
}

async function sendApnsNotification(env, registration, messagePayload, authToken) {
  if (!hasApnsDeliveryConfig(env)) {
    return { skipped: true };
  }

  const response = await fetch(
    `${apnsBaseUrl(env)}/3/device/${encodeURIComponent(registration.push_token)}`,
    {
      method: 'POST',
      headers: {
        authorization: `bearer ${authToken}`,
        'apns-topic': trimString(env.APNS_BUNDLE_ID),
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        aps: {
          alert: {
            title: messagePayload.title,
            body: messagePayload.body,
          },
          sound: 'default',
        },
        type: messagePayload.type,
        conversationUserId: String(messagePayload.conversationUserId),
        senderId: String(messagePayload.senderId),
      }),
    }
  );

  if (response.ok) {
    return { ok: true };
  }

  const errorPayload = await response.json().catch(() => null);
  const reason = trimString(errorPayload?.reason) || `HTTP_${response.status}`;
  if (shouldInvalidateApnsToken(response.status, reason)) {
    await invalidatePushRegistration(registration.id, reason, env);
  } else {
    await markPushRegistrationError(registration.id, reason, env);
  }

  return { ok: false, status: response.status, reason };
}

export function parseWebSubscription(registration) {
  try {
    const parsed = JSON.parse(registration.subscription_json);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const endpoint = trimString(parsed.endpoint);
    const keys = parsed.keys && typeof parsed.keys === 'object' ? parsed.keys : {};
    const p256dh = trimString(keys?.p256dh);
    const auth = trimString(keys?.auth);
    if (!endpoint || !p256dh || !auth) {
      return null;
    }
    return {
      endpoint,
      expirationTime: parsed.expirationTime ?? null,
      keys: {
        p256dh,
        auth,
      },
    };
  } catch (_) {
    return null;
  }
}

async function sendWebPushNotification(env, registration, messagePayload) {
  if (!hasWebPushDeliveryConfig(env)) {
    return { skipped: true };
  }

  const subscription = parseWebSubscription(registration);
  if (!subscription) {
    await invalidatePushRegistration(registration.id, 'INVALID_SUBSCRIPTION', env);
    return { ok: false, status: 400, reason: 'INVALID_SUBSCRIPTION' };
  }

  const payload = JSON.stringify({
    title: messagePayload.title,
    body: messagePayload.body,
    icon: '/icons/Icon-192.png',
    badge: '/icons/Icon-192.png',
    tag: `${messagePayload.type}-${messagePayload.notificationId}`,
    data: {
      type: messagePayload.type,
      conversationUserId: messagePayload.conversationUserId,
      senderId: messagePayload.senderId,
      url: `${messagePayload.appOrigin}/?conversationUserId=${encodeURIComponent(messagePayload.conversationUserId)}`,
    },
  });

  try {
    await webpush.sendNotification(subscription, payload, {
      TTL: 60,
      urgency: 'high',
      topic: messagePayload.notificationId,
      vapidDetails: {
        subject: trimString(env.WEB_PUSH_SUBJECT),
        publicKey: trimString(env.WEB_PUSH_PUBLIC_KEY),
        privateKey: trimString(env.WEB_PUSH_PRIVATE_KEY),
      },
    });
    return { ok: true };
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    const reason = trimString(error?.body || error?.message) || `HTTP_${status}`;
    if (WEB_PUSH_INVALID_STATUS_CODES.has(status)) {
      await invalidatePushRegistration(registration.id, reason, env);
    } else {
      await markPushRegistrationError(registration.id, reason, env);
    }
    return { ok: false, status, reason };
  }
}

export async function sendDirectMessagePush(
  env,
  { senderId, senderName, receiverId, text, kind, appOrigin }
) {
  const registrations = await listActivePushRegistrations(receiverId, env);
  if (!registrations.length) {
    return;
  }

  const apnsAuthToken = registrations.some((item) => item.provider === 'apns')
    ? await createApnsAuthToken(env).catch(() => null)
    : null;

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

      if (registration.provider === 'apns') {
        if (!apnsAuthToken) {
          return { ok: false, reason: 'NO_AUTH_TOKEN' };
        }
        return sendApnsNotification(env, registration, messagePayload, apnsAuthToken);
      }

      return sendWebPushNotification(env, registration, messagePayload);
    })
  );

  // Queue failed pushes for retry
  const failedRegistrations = registrations.filter((reg, index) => {
    const result = results[index];
    return result?.status === 'rejected' || (result?.value && result.value.ok === false);
  });

  for (let i = 0; i < failedRegistrations.length; i++) {
    const registration = failedRegistrations[i];
    const result = results[registrations.indexOf(registration)];
    const pushResult = result?.value || { ok: false, reason: 'UNKNOWN' };

    if (pushResult.reason && APNS_INVALID_REASONS.has(pushResult.reason)) {
      continue; // Permanent failure, don't retry
    }
    if (WEB_PUSH_INVALID_STATUS_CODES.has(pushResult.status)) {
      continue; // Permanent failure, don't retry
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
      provider: registration.provider,
      registrationId: registration.id,
    };

    try {
      await env.PUSH_RETRY?.put?.(
        pushRetryKey(receiverId, notificationId),
        JSON.stringify(retryPayload),
        { expirationTtl: 3600 } // 1 hour TTL
      );
    } catch (_) {
      // KV not available, skip retry
    }
  }
}

/**
 * Process push notification retries from KV queue.
 * Should be called periodically by a scheduled handler.
 * @param {*} env
 */
export async function processPushRetries(env) {
  if (!env.PUSH_RETRY) {
    return { processed: 0, skipped: 0 };
  }

  // List all retry keys (using list with prefix for KV namespace)
  const listResult = await env.PUSH_RETRY.list({ prefix: PUSH_RETRY_KV_PREFIX });
  const processedCount = 0;
  const skippedCount = 0;

  for (const key of (listResult.keys || [])) {
    let payload;
    try {
      const raw = await env.PUSH_RETRY.get(key.name);
      if (!raw) {
        await env.PUSH_RETRY.delete(key.name);
        continue;
      }
      payload = JSON.parse(raw);
    } catch (_) {
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    const { receiverId, senderId, senderName, text, kind, appOrigin, attemptCount, provider, registrationId } = payload;
    const currentAttempt = Number(attemptCount || 0);

    if (!shouldRetryPush(currentAttempt)) {
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    // Find registration and retry push
    const registrations = await listActivePushRegistrations(receiverId, env);
    const registration = registrations.find((r) => r.id === registrationId);

    if (!registration) {
      // Registration deleted, remove retry entry
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    const apnsAuthToken = provider === 'apns'
      ? await createApnsAuthToken(env).catch(() => null)
      : null;

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

    let pushResult;
    if (provider === 'apns' && apnsAuthToken) {
      pushResult = await sendApnsNotification(env, registration, messagePayload, apnsAuthToken);
    } else {
      pushResult = await sendWebPushNotification(env, registration, messagePayload);
    }

    if (pushResult.ok) {
      // Success, remove retry entry
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    // Check if should continue retry
    const isPermanentFailure =
      (provider === 'apns' && APNS_INVALID_REASONS.has(pushResult.reason)) ||
      (provider === 'web' && WEB_PUSH_INVALID_STATUS_CODES.has(pushResult.status));

    if (isPermanentFailure || !shouldRetryPush(currentAttempt + 1)) {
      await env.PUSH_RETRY.delete(key.name);
      continue;
    }

    // Update retry entry with incremented attempt
    const nextAttempt = currentAttempt + 1;
    const updatedPayload = {
      ...payload,
      attemptCount: nextAttempt,
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
  buildPublicPushConfig,
  buildPushNotificationId,
  hasApnsDeliveryConfig,
  hasWebPushDeliveryConfig,
  localizedChatText,
  parseWebSubscription,
  shouldInvalidateApnsToken,
};
