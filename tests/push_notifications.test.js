import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from '../src/features/push_notifications.js';

test('buildPublicPushConfig exposes FCM platforms when client and delivery config exist', () => {
  const config = __testables.buildPublicPushConfig({
    FCM_PROJECT_ID: 'taiwan-brawl',
    FCM_API_KEY: 'public-api-key',
    FCM_APP_ID: '1:123:web:abc',
    FCM_MESSAGING_SENDER_ID: '123',
    FCM_CLIENT_EMAIL: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    FCM_WEB_VAPID_KEY: 'PUBLIC_VAPID_KEY',
    FCM_AUTH_DOMAIN: 'taiwan-brawl.firebaseapp.com',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.deliveryEnabled, true);
  assert.equal(config.provider, 'fcm');
  assert.deepEqual(config.enabledPlatforms, ['android', 'ios', 'macos', 'web']);
  assert.equal(config.fcm.projectId, 'taiwan-brawl');
  assert.equal(config.fcm.webVapidKey, 'PUBLIC_VAPID_KEY');
  assert.equal(config.fcm.serviceWorkerPath, '/firebase-messaging-sw.js');
});

test('buildPublicPushConfig disables delivery without service account credentials', () => {
  const config = __testables.buildPublicPushConfig({
    FCM_PROJECT_ID: 'taiwan-brawl',
    FCM_API_KEY: 'public-api-key',
    FCM_APP_ID: '1:123:web:abc',
    FCM_MESSAGING_SENDER_ID: '123',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.deliveryEnabled, false);
  assert.deepEqual(config.enabledPlatforms, []);
});

test('validatePushRequestBody accepts FCM token registrations', () => {
  const request = new Request('https://example.com/api/notifications/register');
  const validation = __testables.validatePushRequestBody(request, {
    installationId: 'install-1',
    platform: 'android',
    provider: 'fcm',
    token: 'a'.repeat(64),
  });

  assert.equal(validation.error, undefined);
});

test('validatePushRequestBody rejects legacy provider and subscription payloads', async () => {
  const request = new Request('https://example.com/api/notifications/register');

  const providerValidation = __testables.validatePushRequestBody(request, {
    installationId: 'install-1',
    platform: 'web',
    provider: 'webpush',
    token: 'a'.repeat(64),
  });
  assert.equal(providerValidation.error.status, 400);
  assert.equal((await providerValidation.error.json()).error, 'provider must be fcm');

  const subscriptionValidation = __testables.validatePushRequestBody(request, {
    installationId: 'install-1',
    platform: 'web',
    subscription: {
      endpoint: 'https://example.com/push',
      keys: {
        p256dh: 'public-key',
        auth: 'auth-secret',
      },
    },
  });
  assert.equal(subscriptionValidation.error.status, 400);
  assert.equal((await subscriptionValidation.error.json()).error, 'token is required for fcm');
});

test('validatePushRequestBody rejects unsupported platforms', async () => {
  const request = new Request('https://example.com/api/notifications/register');
  const validation = __testables.validatePushRequestBody(request, {
    installationId: 'install-1',
    platform: 'linux',
    token: 'a'.repeat(64),
  });

  assert.equal(validation.error.status, 400);
  assert.equal(
    (await validation.error.json()).error,
    'platform must be android, ios, macos, or web'
  );
});

test('localizedChatText returns localized recall copy', () => {
  assert.deepEqual(
    __testables.localizedChatText({
      locale: 'en-US',
      senderName: 'Alex',
      text: '',
      kind: 'recall',
    }),
    { title: 'Alex', body: 'Recalled a message' }
  );

  assert.deepEqual(
    __testables.localizedChatText({
      locale: 'ja-JP',
      senderName: 'Alex',
      text: '',
      kind: 'recall',
    }),
    { title: 'Alex', body: 'メッセージを取り消しました' }
  );
});

test('buildPushNotificationId normalizes UUIDs into topic-safe unique ids', () => {
  assert.equal(
    __testables.buildPushNotificationId(() => '123e4567-e89b-12d3-a456-426614174000'),
    '123e4567e89b12d3a456426614174000'
  );

  assert.equal(
    __testables.buildPushNotificationId(() => 'ABC-123'),
    'abc123'
  );
});

test('buildFcmMessage uses string-only data and platform overrides', () => {
  const message = __testables.buildFcmMessage(
    { push_token: 'token-123' },
    {
      title: 'Alex',
      body: 'Hello',
      type: 'dm_message',
      notificationId: 'abc123',
      conversationUserId: 42,
      senderId: 42,
      appOrigin: 'https://example.com',
    }
  );

  assert.equal(message.token, 'token-123');
  assert.deepEqual(message.notification, { title: 'Alex', body: 'Hello' });
  assert.equal(message.data.conversationUserId, '42');
  assert.equal(message.data.senderId, '42');
  assert.equal(message.webpush.fcm_options.link, 'https://example.com/?conversationUserId=42');
  assert.equal(message.android.notification.click_action, 'FLUTTER_NOTIFICATION_CLICK');
});

test('shouldInvalidateFcmToken recognizes permanent FCM token failures', () => {
  assert.equal(__testables.shouldInvalidateFcmToken(404, 'NOT_FOUND'), true);
  assert.equal(__testables.shouldInvalidateFcmToken(400, 'UNREGISTERED'), true);
  assert.equal(__testables.shouldInvalidateFcmToken(500, 'INTERNAL'), false);
});
