# Push Notifications Setup

Push delivery is unified on Firebase Cloud Messaging (FCM).

Current delivery provider:

- `Android`: FCM registration token
- `iOS`: FCM registration token, backed by APNs through Firebase
- `macOS`: FCM registration token, backed by APNs through Firebase
- `Web`: FCM registration token with a Firebase Web VAPID key

Current app-side behavior:

- Device registration: `POST /api/notifications/register`
- Device unregister: `POST /api/notifications/unregister`
- Public push bootstrap config: `GET /api/notifications/config`
- Server-side dispatch: direct message send / recall events

## 1. Firebase project setup

Create or use one Firebase project for Taiwan Brawl, then register these apps:

- Android package: `com.yunitrish.taiwanbrawl`
- iOS bundle ID: the Runner bundle ID used by the release build
- macOS bundle ID, if macOS push is shipped
- Web app for Flutter Web

For Apple platforms, upload the APNs key or certificates in Firebase Console so FCM can deliver through APNs.

For Web, create a Web Push certificate key pair in Firebase Console. The public VAPID key is exposed to the client as `FCM_WEB_VAPID_KEY`.

## 2. Worker secrets / vars

Public Firebase app config, safe to expose through `/api/notifications/config`:

- `FCM_PROJECT_ID`
- `FCM_API_KEY`
- `FCM_APP_ID`
- `FCM_MESSAGING_SENDER_ID`
- `FCM_AUTH_DOMAIN`
- `FCM_STORAGE_BUCKET`
- `FCM_MEASUREMENT_ID`
- `FCM_IOS_BUNDLE_ID`
- `FCM_WEB_VAPID_KEY`

Server-side FCM HTTP v1 credentials, store as secrets:

- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY`

Recommended Wrangler commands:

```bash
wrangler secret put FCM_API_KEY
wrangler secret put FCM_APP_ID
wrangler secret put FCM_MESSAGING_SENDER_ID
wrangler secret put FCM_PROJECT_ID
wrangler secret put FCM_WEB_VAPID_KEY
wrangler secret put FCM_CLIENT_EMAIL
wrangler secret put FCM_PRIVATE_KEY
```

`FCM_PRIVATE_KEY` can be pasted from the Firebase service account JSON. Keep the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` wrapper. Escaped `\n` line breaks are accepted.

## 3. Database migration

Apply:

- `migrations/0028_fcm_push_registrations.sql`

The migration keeps the old APNs/Web Push registrations in `push_registrations_legacy_0028`, then creates a new `push_registrations` table for FCM tokens.

## 4. Frontend behavior

- Flutter initializes Firebase from `/api/notifications/config`.
- `firebase_messaging` requests permission and retrieves one FCM token per installation/platform.
- Web uses `/firebase-messaging-sw.js` for background notification display and notification-click routing.
- The existing DM polling flow remains the source of message data; push is still only a background reminder/open affordance.

## 5. Current notification coverage

Already implemented:

- Direct message push notifications
- Message recall push notifications
- Notification open payload with `conversationUserId`

Not yet implemented:

- Friend request pushes
- Room invite pushes
