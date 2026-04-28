import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from '../src/features/push_notifications.js';

test('buildPublicPushConfig exposes ios and web only when provider config exists', () => {
  const config = __testables.buildPublicPushConfig({
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID: 'KEY1234567',
    APNS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    APNS_BUNDLE_ID: 'com.yunitrish.taiwanbrawl',
    WEB_PUSH_PUBLIC_KEY: 'PUBLIC_KEY',
    WEB_PUSH_PRIVATE_KEY: 'PRIVATE_KEY',
    WEB_PUSH_SUBJECT: 'mailto:push@example.com',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.deliveryEnabled, true);
  assert.deepEqual(config.enabledPlatforms, ['ios', 'web']);
  assert.equal(config.web.publicKey, 'PUBLIC_KEY');
  assert.equal(config.web.serviceWorkerPath, '/web-push-sw.js');
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

test('parseWebSubscription accepts valid subscription JSON and rejects bad payloads', () => {
  assert.deepEqual(
    __testables.parseWebSubscription({
      subscription_json: JSON.stringify({
        endpoint: 'https://example.com/push',
        expirationTime: null,
        keys: {
          p256dh: 'public-key',
          auth: 'auth-secret',
        },
      }),
    }),
    {
      endpoint: 'https://example.com/push',
      expirationTime: null,
      keys: {
        p256dh: 'public-key',
        auth: 'auth-secret',
      },
    }
  );

  assert.equal(
    __testables.parseWebSubscription({
      subscription_json: '{"endpoint":"","keys":{"p256dh":"","auth":""}}',
    }),
    null
  );
});

test('shouldInvalidateApnsToken recognizes APNs permanent failures', () => {
  assert.equal(__testables.shouldInvalidateApnsToken(410, 'Unregistered'), true);
  assert.equal(__testables.shouldInvalidateApnsToken(400, 'BadDeviceToken'), true);
  assert.equal(__testables.shouldInvalidateApnsToken(500, 'InternalServerError'), false);
});
