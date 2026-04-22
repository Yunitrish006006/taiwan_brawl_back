# Taiwan Brawl Backend

Taiwan Brawl Backend 是這個專案的 Cloudflare Workers 後端，負責 API、即時房間、資料儲存、媒體存取與推播發送。

目前這個 repo 主要負責：

- 使用者登入與 session
- 好友、私訊與社交 API
- Royale 房間與對戰狀態
- D1 資料表與 migration
- KV 靜態資產與媒體讀寫
- APNs / Web Push 推播
- Flutter Web 靜態站部署入口

前端 Flutter app 位於同層的 `../taiwan_brawl_front`。

## 技術堆疊

- Cloudflare Workers
- Cloudflare D1
- Cloudflare KV
- Cloudflare Durable Objects
- Wrangler
- Node.js tooling

## 架構摘要

這個 Worker 同時提供三類內容：

- `/api/*` 業務 API
- `/card-images/*`、`/user-avatars/*` 媒體資源
- Flutter Web 靜態站

主要執行時組件：

- `D1`
  - 使用者、session、好友、牌組、聊天、推播註冊資料
- `KV STATIC_ASSETS`
  - Flutter Web build 產物
  - 卡牌圖片
  - 使用者上傳頭像
- `Durable Objects`
  - `ROYALE_ROOM`
  - `CHAT_ROOM`
  - `SIGNAL_ROOM`

## 主要模組

```text
src/
├── index.js                  # Worker 入口
├── api_router.js             # API 路由分派
├── auth.js                   # Google 登入 / session
├── users.js                  # 使用者資料 / 頭像 / 偏好設定
├── friends_api.js            # 好友與邀請
├── chat_api.js               # DM / pending / recall
├── notifications_api.js      # 推播設定與裝置註冊
├── push_notifications.js     # APNs / Web Push 實作
├── rooms_api.js              # Royale 房間 API
├── royale_room*.js           # Royale 房間與戰鬥邏輯
├── chat_room.js              # DM Durable Object
├── signal_room.js            # WebRTC signaling Durable Object
└── media_api.js              # 卡圖 / 頭像媒體回應
```

## 本機開發

先安裝依賴：

```bash
npm ci
```

本機啟動 Worker：

```bash
npm run dev
```

跑測試：

```bash
npm test
```

## 部署

主要部署腳本：

```bash
./deploy.sh
```

這支腳本目前會自動執行：

1. 生成前端 locale catalog
2. 建置 Flutter Web
3. 生成 `assets.json`
4. 安裝後端 npm 依賴（若缺少）
5. 套用 D1 migrations
6. 上傳靜態檔到 KV
7. 部署 Worker
8. 執行 smoke tests

## 重要文件

- 整體架構：[docs/architecture.md](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/docs/architecture.md:1)
- 遊戲規則：[docs/game_rules.md](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/docs/game_rules.md:1)
- 推播設定：[docs/push_notifications_setup.md](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/docs/push_notifications_setup.md:1)
- 部署工具規格：[CODEX_DEPLOY_TOOLKIT.md](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/CODEX_DEPLOY_TOOLKIT.md:1)

## 目前狀態

- 私訊接收目前仍以 `pending_messages` polling 為主
- Web Push 與 iOS APNs 已接上
- Android 背景 native push 尚未實作
- Royale 房間即時狀態由 Durable Object 驅動
