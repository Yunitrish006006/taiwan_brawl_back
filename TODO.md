# Taiwan Brawl Backend - TODO

## 高優先 (High Priority)

### 1. SignalRoom 錯誤處理與日誌 ✅
- [x] 為 WebSocket 訊息處理加上 try-catch
- [x] 加入訊號轉發失敗的錯誤追蹤
- [x] 記錄連線/斷線事件
- [x] 檔案：`src/rooms/signal_room.js`

### 2. D1 查詢結果 null check ✅

- [x] 檢查所有 `await env.DB.prepare(...).all()` 的結果是否為 null
- [x] 確保 `.results` 屬性不存在時有 fallback
- [x] 檔案：多個 repository 檔案

## 中優先 (Medium Priority)

### 3. 推播失敗重試機制 ✅

- [x] 實作失敗推播的重試邏輯（3 次重試：30s, 2min, 10min）
- [x] 使用 KV 佇列存儲待重試的推播任務
- [x] 避免重試無效的 token（如 404、410）
- [x] 實作 `processPushRetries` handler
- [x] ⚠️ 手動建立 KV: `wrangler kv namespace create PUSH_RETRY`，更新 `wrangler.jsonc` ID
- [x] 檔案：`src/features/push_notifications.js`

### 4. Chat pending 訊息分頁 ✅

- [x] 為 `handleGetPending` 加入分頁機制
- [x] 加入 limit/offset 參數（預設 50，最大 100）
- [x] 回傳 total、hasMore 供前端分頁
- [x] 檔案：`src/api/chat_api.js`

### 5. last_active_at 更新頻率優化 ✅

- [x] 使用 KV 快取追蹤上次更新時間
- [x] 每 3 分鐘才更新 DB（throttle）
- [x] KV 失敗時容錯降級
- [x] 檔案：`src/core/utils.js`

## 低優先 (Low Priority)

### 6. 速率限制 (Rate Limiting) ✅

- [x] 實作 API 速率限制 middleware
- [x] 針對敏感端點（login, chat send）限流
- [x] 檔案：`src/core/rate_limit.js`, `src/api/api_router.js`

### 7. Request ID 追蹤 ✅

- [x] 為每個請求生成 unique ID
- [x] 在錯誤回應中包含 request ID
- [x] 回應 header 帶 X-Request-ID
- [x] 檔案：`src/core/utils.js`

### 8. CORS 設定收紧 ✅

- [x] 限制 localhost 只能特定 port（23 個常見 dev ports）
- [x] 加入 Access-Control-Max-Age 減少 preflight 請求
- [x] 拒絕無 Origin 的 API 請求
- [x] 檔案：`src/core/utils.js`

### 9. 單元測試覆蓋 ✅

- [x] 為核心模組新增 Node test
- [x] 覆蓋：utils（23 個測試）
- [ ] 可擴展到 auth、friends_repository（未來）
- [x] 檔案：`tests/utils.test.js`

### 10. 刪除操作安全檢查 ✅

- [x] 為 `deleteFriendshipBetween` 加入存在性檢查
- [x] 為 `unblockUser` 加入存在性檢查
- [x] 檔案：`src/features/friends_repository.js`

## 改進建議 (Improvements)

### A. Sessions 清理機制 🔴

- [x] 建立清理過期 sessions 的 handler
- [x] 提供統計 API 和清理 API
- [x] 需要設定 CLEANUP_SECRET_KEY secret
- [ ] 可整合 Cloudflare Cron Trigger 定時執行
- [x] 檔案：`src/features/session_cleanup.js`, `src/api/session_cleanup_api.js`

### B. Sessions user_id index 🔴

- [x] 新增 migration 為 sessions.user_id 建立 index
- [x] 提升大量用戶同時登入時的效能
- [x] 檔案：`migrations/0027_sessions_user_id_index.sql` ✅ 已執行

### C. 展開單元測試覆蓋 🟡

- [ ] 為 auth 模組新增測試
- [ ] 為 friends_repository 新增測試
- [ ] 增加測試覆蓋率

### D. Push Retry KV 初始化 🟡

- [ ] 在部署時自動建立 PUSH_RETRY KV（若有需要）
- [ ] 或在文件說明需手動建立

## 已完成 (Completed)

- [ ]
</parameter>
