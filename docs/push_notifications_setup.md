# Push Notifications Setup

This implementation does not use Firebase.

Current delivery providers:

- `iOS`: Apple Push Notification service (`APNs`)
- `Web`: Web Push (`VAPID`)
- `Android`: no background native push in this repo; it remains foreground polling only

Current app-side behavior:

- Device registration: `POST /api/notifications/register`
- Device unregister: `POST /api/notifications/unregister`
- Public push bootstrap config: `GET /api/notifications/config`
- Server-side dispatch: direct message send / recall events

## 1. APNs setup

Required Worker secrets / vars:

- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY`
- `APNS_BUNDLE_ID`
- `APNS_USE_SANDBOX`

Recommended Wrangler commands:

```bash
wrangler secret put APNS_TEAM_ID
wrangler secret put APNS_KEY_ID
wrangler secret put APNS_PRIVATE_KEY
wrangler secret put APNS_BUNDLE_ID
```

For development builds, set:

- `APNS_USE_SANDBOX=true`

For TestFlight / App Store builds, either omit it or set:

- `APNS_USE_SANDBOX=false`

You still need to finish the Apple-side capability setup in Xcode / Apple Developer:

- Enable `Push Notifications` capability for `Runner`
- Ensure the app ID / provisioning profile supports push
- Use the same bundle ID as `APNS_BUNDLE_ID`

## 2. Web Push setup

Required Worker secrets / vars:

- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`

Generate a VAPID key pair once:

```bash
npx web-push generate-vapid-keys
```

Then store them:

```bash
wrangler secret put WEB_PUSH_PUBLIC_KEY
wrangler secret put WEB_PUSH_PRIVATE_KEY
wrangler secret put WEB_PUSH_SUBJECT
```

Notes:

- `WEB_PUSH_SUBJECT` should be a real `mailto:` or `https:` URI
- Do not use `https://localhost` as the subject if you need Safari web push
- The web app must be served over `HTTPS`

## 3. Worker runtime requirement

`web-push` requires Node.js compatibility in Cloudflare Workers.

`wrangler.jsonc` now enables:

- `compatibility_flags: ["nodejs_compat"]`

## 4. Database migration

Apply:

- `migrations/0020_push_registrations.sql`

It stores:

- iOS APNs tokens
- Web Push subscriptions

## 5. Frontend behavior

- `iOS`: requests notification permission and registers directly with APNs
- `Web`: registers `web-push-sw.js`, asks browser permission, subscribes via VAPID
- `Android`: still uses the in-app polling flow only

## 6. Current notification coverage

Already implemented:

- Direct message push notifications
- Message recall push notifications
- Notification open payload with `conversationUserId`

Not yet implemented:

- Friend request pushes
- Room invite pushes
- Android background native push
