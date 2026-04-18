# Taiwan Brawl Architecture

最後更新：2026-04-18

## 1. 專案總覽

Taiwan Brawl 目前是「雙 repo、單站點」架構：

- 前端：Flutter 專案，位於 `../taiwan_brawl_front`
- 後端：Cloudflare Workers 專案，位於目前這個 repo
- 對外入口：同一個 Worker 同時提供
  - `/api/*` API
  - `/card-images/*`、`/user-avatars/*` 媒體資源
  - Flutter Web 靜態站

部署後，使用者看到的是同一個網域：

- Worker 處理 API
- Worker 從 KV 取出 Flutter Web build 產物並回應

## 2. Repo 佈局

```text
taiwan_brawl/
├── taiwan_brawl_back/
│   ├── src/                  # Cloudflare Worker API / Durable Objects
│   ├── migrations/           # D1 schema migrations
│   ├── docs/                 # 專案文件
│   ├── wrangler.jsonc        # Worker bindings / DO / D1 / KV
│   └── upload.js             # Flutter Web build -> assets.json
└── taiwan_brawl_front/
    ├── lib/                  # Flutter app
    ├── web/                  # Web push JS bridge / service worker
    └── build/web/            # Flutter Web 輸出，部署前生成
```

## 3. 執行時拓樸

```text
Flutter App / Browser
        |
        v
   Cloudflare Worker
   - src/index.js
   - src/api_router.js
        |
        +--> D1 (業務資料)
        |    - users / sessions
        |    - friends / decks / cards / chat / push registrations
        |
        +--> KV STATIC_ASSETS
        |    - Flutter Web 靜態檔
        |    - 卡牌圖片
        |    - 上傳頭像
        |
        +--> Durable Objects
             - ROYALE_ROOM
             - CHAT_ROOM
             - SIGNAL_ROOM
```

## 4. 前端架構

### 4.1 App 啟動

前端入口是 `lib/main.dart`。

啟動流程：

1. `WidgetsFlutterBinding.ensureInitialized()`
2. `ChatService.initHive()` 初始化本地儲存
3. 建立 `ApiClient`
4. 建立 `NotificationService` 並先 `initialize()`
5. 用 `Provider` 注入全域狀態

目前主要的全域 service / provider：

- `AuthService`
- `NotificationService`
- `FriendsOverviewSyncService`
- `ThemeProvider`
- `UiSettingsProvider`
- `LocaleProvider`

### 4.2 路由與頁面

`MaterialApp` 目前主要路由：

- `/` `SplashPage`
- `/login` `AuthPage`
- `/home` `HomePage`
- `/profile` `ProfilePage`
- `/admin/cards`
- `/admin/roles`
- `/royale-lobby`
- `/royale-deck`

`HomePage` 是社交與主功能入口，負責：

- 顯示好友 / 邀請 / 房間邀請總覽
- 開啟 DM
- 依推播或 polling 結果自動導向對話

### 4.3 API 存取與認證

前端所有 HTTP 請求都走 `lib/services/api_client.dart`。

認證模式分兩種：

- Web：依賴瀏覽器 cookie 中的 `session_id`
- Mobile/Desktop 非 Web：把後端回傳的 `session_id` 存在 `ApiClient._mobileSessionId`，之後走 `Authorization: Bearer <session_id>`

登入流程：

- 前端把 Google `id_token` 送到 `POST /api/google-login`
- 後端驗證 token payload，建立或更新使用者
- 後端建立 `sessions` 記錄並回傳 `session_id`
- 前端再用 `GET /api/me` / `GET /api/users/me` 取完整使用者資料

### 4.4 聊天與通知

目前前端實際使用的 DM 路徑是「本地快取 + polling」：

- `ChatService`
  - 歷史訊息優先從 Hive 讀
  - 第一次打開對話時，沒有本地資料才打 `/api/chat/dm/:friendId/history`
  - 每 2 秒 polling `/api/chat/dm/pending`
  - 收到後寫入 Hive，再呼叫 `/api/chat/dm/ack`
- `NotificationService`
  - 登入後會註冊目前裝置的 push registration
  - 也會每 2 秒 polling `/api/chat/dm/pending`
  - 收到背景訊息時更新本地資料並設定 `pendingConversationUserId`
  - `HomePage` 看到這個值後會自動打開對應 DM

關鍵點：

- 目前 DM 收訊主流程不是 socket-first，而是 polling-first
- 後端雖然有 `CHAT_ROOM` Durable Object，但目前 Flutter app 的主要接收路徑仍是 `pending_messages`

### 4.5 Royale 遊戲層

`RoyaleService` 封裝卡牌、牌組、英雄與房間 API：

- `GET /api/cards`
- `GET /api/heroes`
- `GET /api/decks`
- `POST /api/decks`
- `POST /api/rooms`
- `POST /api/rooms/:code/join|ready|rematch|host-finish`
- `GET /api/rooms/:code/state`
- `GET /api/rooms/:code/ws`

`RoyaleLobbyPage` 負責：

- 載入牌組與英雄
- 建立房間 / 加入房間
- 進入 `RoyaleArenaPage`

即時戰鬥狀態透過房間 WebSocket 接收，後端核心狀態由 `ROYALE_ROOM` Durable Object 持有。

### 4.6 Web Push 橋接

Web Push 由三層組成：

- `lib/services/web_push_bridge_web.dart`
  - Flutter 與瀏覽器 JS bridge 的 Dart interop
- `web/push_notifications.js`
  - 註冊 service worker
  - 向瀏覽器要求通知權限
  - 建立 Web Push subscription
- `web/web-push-sw.js`
  - 在背景收到 push 時 `showNotification()`
  - 點通知後導回 `/?conversationUserId=<senderId>`

## 5. 後端架構

### 5.1 Worker 入口

Worker 入口是 `src/index.js`。

請求順序：

1. 先處理 `OPTIONS`
2. 先嘗試 `handleMediaRequest()`
3. 若路徑是 `/api/*`，交給 `handleApiRequest()`
4. 其他請求一律視為靜態站資源，從 `STATIC_ASSETS` 讀取

這代表目前「API + 媒體 + 網站」都在同一個 Worker 內。

### 5.2 API Router

`src/api_router.js` 把路由拆成兩種：

- exact routes
  - 例如 `/api/health`、`/api/me`、`/api/logout`
- dynamic routes
  - 例如 `/api/rooms/:code/...`
  - `/api/chat/dm/:friendId/...`
  - `/api/chat/signal/:friendId`

主要模組：

- `auth.js`
- `users.js`
- `friends_api.js`
- `rooms_api.js`
- `chat_api.js`
- `signal_api.js`
- `notifications_api.js`
- `admin_api.js`
- `llm_bot_api.js`
- `media_api.js`

### 5.3 Durable Objects

#### `ROYALE_ROOM`

負責單一對戰房間的即時狀態與戰鬥循環：

- 房間建立 / 加入 / ready / rematch
- 房間 WebSocket
- 戰鬥 tick 與狀態推進
- 依固定間隔持久化到 DO storage
- 對戰結束後寫入 D1 `match_history`

相關檔案：

- `src/royale_room.js`
- `src/royale_room_runtime.js`
- `src/royale_room_state.js`
- `src/royale_room_combat.js`

#### `CHAT_ROOM`

負責單一 DM 對話的 WebSocket 與歷史查詢：

- DO 名稱規則：`dm:<low_id>:<high_id>`
- WebSocket 接收 `send_message`
- 訊息持久化到 D1 `chat_messages`
- 支援 `/internal/history`

注意：

- 這個 DO 存在且可用
- 但目前 Flutter app 的主要 DM 收訊路徑仍是 `pending_messages` polling

#### `SIGNAL_ROOM`

負責 WebRTC signaling relay：

- DO 名稱規則：`signal:<low_id>:<high_id>`
- 不做 D1 持久化
- 只在雙方線上時轉送 signaling payload

### 5.4 認證與 Session

`auth.js` 目前使用 Google ID token payload 進行登入，不另外維護密碼。

後端流程：

1. 解碼 `id_token`
2. 以 email 查 `users`
3. 新使用者就建帳號
4. 建立 `sessions`
5. 回傳 `session_id`

Session 特性：

- 一個使用者重新登入時，會先刪掉舊 session 再建立新 session
- TTL 目前為 30 天
- Web 透過 cookie
- 非 Web 客戶端透過 Bearer token

### 5.5 推播系統

推播 API 在 `notifications_api.js`，真正實作在 `push_notifications.js`。

目前支援：

- iOS：APNs
- Web：VAPID Web Push
- Android：沒有背景 native push，仍以前景 polling 為主

主要 API：

- `GET /api/notifications/config`
- `POST /api/notifications/register`
- `POST /api/notifications/unregister`

推播註冊資料進 D1 `push_registrations`。

DM 送出後：

1. 寫入 `pending_messages`
2. 背景呼叫 `sendDirectMessagePush()`
3. 依裝置類型分送 APNs 或 Web Push
4. 無效 token / subscription 會標記 `invalidated_at`

目前每一則新訊息都會產生獨立 `notificationId`，避免新通知覆蓋舊通知。

## 6. 主要資料流

### 6.1 Flutter Web 部署資料流

```text
flutter build web
    -> build/web
    -> upload.js 產生 assets.json
    -> wrangler kv bulk put
    -> Worker 從 STATIC_ASSETS 提供網站
```

### 6.2 登入資料流

```text
Flutter AuthService
    -> POST /api/google-login
    -> users / sessions
    -> session_id
    -> GET /api/me
```

### 6.3 DM 訊息資料流

```text
Sender
    -> POST /api/chat/dm/:friendId/send
    -> D1 pending_messages
    -> 背景觸發 sendDirectMessagePush()

Receiver
    -> NotificationService / ChatService polling
    -> GET /api/chat/dm/pending
    -> Hive local cache
    -> POST /api/chat/dm/ack
```

### 6.4 Web Push 資料流

```text
Browser
    -> /api/notifications/config
    -> /api/notifications/register
    -> D1 push_registrations

New DM
    -> sendDirectMessagePush()
    -> web-push sendNotification()
    -> web-push-sw.js showNotification()
    -> click -> /?conversationUserId=<senderId>
```

### 6.5 Royale 房間資料流

```text
Flutter RoyaleService
    -> /api/rooms
    -> rooms_api.js
    -> ROYALE_ROOM Durable Object
    -> room state / WebSocket updates
    -> 結束後寫回 D1 match_history
```

## 7. 資料儲存

### 7.1 D1 關鍵表

目前最重要的表：

- `users`
  - 帳號、角色、語系、主題、頭像來源、LLM 設定
- `sessions`
  - session id 與有效期限
- `friend_requests`
- `friendships`
- `user_blocks`
- `room_invites`
- `cards`
- `user_decks`
- `user_deck_cards`
- `match_history`
- `chat_messages`
  - DO WebSocket / 歷史訊息持久化
- `pending_messages`
  - 目前 app 端 DM 收訊主流程
- `push_registrations`
  - iOS token / Web subscription

### 7.2 KV `STATIC_ASSETS`

同一個 KV namespace 目前承載三類資料：

- Flutter Web build 產物
- 卡牌圖片
  - key 例如 `card-image:<cardId>`
- 使用者上傳頭像
  - key 例如 `user-avatar:<userId>`

### 7.3 Durable Object Storage

`ROYALE_ROOM` 自己也會用 DO storage 保存房間狀態快照。  
這是房間即時狀態層，不取代 D1 的長期資料。

## 8. 目前的實作重點與注意事項

### 8.1 DM 有兩套路徑

後端目前同時存在：

- `CHAT_ROOM` WebSocket + `chat_messages`
- `pending_messages` polling + push

但目前 Flutter app 實際主要走的是第二條。  
如果未來要全面切到 socket-first，需要一起調整前端 `ChatService`。

### 8.2 Push 與訊息持久化是分開的

DM 不是只靠推播。

- 訊息先進 `pending_messages`
- Push 只是額外提醒

因此就算某次推播失敗，接收端下次 polling 仍能補收。

### 8.3 Android 背景推播尚未完成

目前文件與程式都一致：

- iOS：APNs
- Web：Web Push
- Android：前景 polling only

### 8.4 同一個 Worker 承載所有對外入口

優點：

- 部署與網域管理簡單
- 不需要分離前端站點與 API

代價：

- API、靜態檔、媒體路由都耦合在同一個 Worker
- 後續若拆服務，需要一起重整路由與部署方式

## 9. 建議後續維護方式

這份文件應在以下變更時同步更新：

- 新增或移除 Durable Object
- 改動主要資料流
- 調整認證方式
- 把聊天由 polling 改成 WebSocket-first
- 新增 Android 背景推播
- 拆分前端站點與 API 部署
