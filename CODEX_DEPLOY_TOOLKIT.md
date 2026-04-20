# Codex Deploy Toolkit Spec

這份文件是給其他專案中的 Codex 使用的實作規格。  
目標是在「後端 repo + 同層 Flutter Web 前端 repo」的專案裡，重建和本專案相同的一套：

- `deploy.sh`
- `conventional_commit_rules.sh`
- `tool/suggest_commit_message.sh`
- `package.json` 內的 commit 建議 scripts

這套工具的核心特性是：

- `deploy.sh` 會自動做版本判定、前端 build、資產清單產生、D1 migrations、KV 上傳、Workers deploy、smoke tests。
- 版本是純 `semver`，例如 `0.2.0`，不使用 `+build`。
- 版本判定優先看 `Conventional Commits`（since 上次 `pubspec.yaml` 被 commit 的時間點），沒有足夠訊息時再 fallback 到目前未 commit 的檔案路徑規則。
- 版本判定同時看後端 repo 與前端 repo，取最高層級。
- commit 建議工具輸出的是：
  - 英文 `type(scope):`
  - 中文摘要

例如：

```text
feat(profile): 更新個人資料頁體驗
refactor(royale): 重整 Royale 房間運行邏輯
fix(friends): 改善好友 API 流程
```

---

## 給 Codex 的直接指令

把下面這段原封不動丟給另一個專案裡的 Codex 即可：

```md
請在這個專案中建立一套和 Taiwan Brawl 相同風格的 deploy/version/commit toolkit。

專案假設：
- 後端 repo 內有 Cloudflare Workers 專案。
- 同層有 Flutter Web 前端 repo。
- 後端會有 `wrangler.jsonc`、`upload.js`、`assets.json`。
- 前端版本號在 `pubspec.yaml`。

請建立或更新以下檔案：

1. `deploy.sh`
2. `conventional_commit_rules.sh`
3. `tool/suggest_commit_message.sh`
4. `package.json` scripts

實作要求：

- `deploy.sh` 要支援環境變數覆寫：
  - `VERSION`（指定時跳過自動 bump 直接使用）
  - `WRANGLER_VERSION`（預設 `latest`）
  - `VERSION_BUMP`（`auto|major|minor|patch|none`，預設 `auto`）
  - `FRONTEND_DIR`（手動指定前端目錄）
  - `FLUTTER_BIN_DIR`（手動指定 Flutter SDK 路徑）
  - `D1_DATABASE_NAME`（手動指定 D1 資料庫名）
  - `KV_NAMESPACE_ID`（手動指定 KV namespace ID）
  - `DEPLOY_BASE_URL`（smoke test 用的 base URL）
- 清除 `NODE_TLS_REJECT_UNAUTHORIZED=0` 防止意外停用 TLS 驗證。
- `deploy.sh` 需先嘗試自動找到 Flutter 前端目錄（依序）：
  1. `$FRONTEND_DIR`
  2. `../<frontend repo name>`（從 wrangler.jsonc 推斷）
  3. `../front`
- 需自動找 Flutter SDK bin 目錄（依序）：
  1. `$FLUTTER_BIN_DIR`
  2. `command -v flutter` 的所在資料夾
  3. `/Volumes/DataExtended/flutter/bin`
  4. `~/flutter/bin`
  5. `~/development/flutter/bin`
- 如果前端有 `tool/generate_locale_catalog.dart`，在 build 前先執行：
  - `dart run tool/generate_locale_catalog.dart`
- 版本規則要是純 semver，不要有 `+build`。
- 讀前端 `pubspec.yaml` 的版本作為 base，deploy 成功後寫回新版本（用 awk）。
- `VERSION_BUMP=auto` 的邏輯：
  1. 找出 `pubspec.yaml` 最後一次 git commit 的 epoch 時間作為 anchor。
  2. 從 anchor 以來的 git log（後端 + 前端各自），用 Conventional Commits 判斷 bump。
  3. 同時掃描目前 **未 commit** 的 `git status` 檔案路徑規則（後端 + 前端各自）。
  4. 取 4 者最高層級。
- `Conventional Commits` 規則：
  - `feat` -> `minor`
  - `fix` / `perf` / `refactor` -> `patch`
  - `!` 或 `BREAKING CHANGE:` / `BREAKING-CHANGE:` -> `major`
  - `docs` / `test` / `build` / `ci` / `chore` / `style` / `revert` -> `none`
  - 無法辨識的 type -> `none`
- fallback 檔案路徑規則：
  - ignored paths → 跳過不計算 bump
  - minor paths → `minor`
  - patch paths → `patch`
  - 新增（A）或刪除（D）的檔案（且非 ignored）→ 至少 `minor`
- deploy 步驟（依序）：
  1. `[1/5]` locale catalog generation（如果存在）
  2. `[2/5]` `flutter build web --release --build-name=<version>`
  3. `[3/5]` `node upload.js`（如果存在）+ `[3.5/6]` backend npm install（如果 node_modules 缺依賴）
  4. `[4/6]` D1 migrations apply（如果有 migrations 目錄）
  5. `[5/6]` KV bulk put assets.json（如果有 assets.json）
  6. `[6/6]` `wrangler deploy`
  7. `[6.5/6]` smoke tests
  8. pubspec.yaml 版本寫回
- D1 database name 優先用 `D1_DATABASE_NAME`，否則從 `wrangler.jsonc` 的 `d1_databases[0].database_name` 讀取。
- KV namespace ID 優先用 `KV_NAMESPACE_ID`，否則從 `wrangler.jsonc` 的 `kv_namespaces` 找 binding=`STATIC_ASSETS` 的 `id`。
- smoke tests 檢查：
  - `GET /` → HTTP 200
  - `GET /login` → HTTP 200
  - `GET /api/health` → response body 包含 `"ok":true`
- 輸出訊息使用英文。
- wrangler 指令用 `npm exec --package=wrangler@<version> --` 執行，確保版本一致。

- `conventional_commit_rules.sh` 集中管理：
  - `CC_MINOR_TYPES`
  - `CC_PATCH_TYPES`
  - `CC_NONE_TYPES`
  - `CC_VERSION_IGNORED_PATHS`
  - `CC_VERSION_MINOR_PATHS`
  - `CC_VERSION_PATCH_PATHS`
  - `CC_SCOPE_RULES`（格式：`"pattern|scope|type|中文摘要"`）
- `deploy.sh` 在 script 開頭也宣告預設陣列，再 source `conventional_commit_rules.sh` 覆蓋。

- `tool/suggest_commit_message.sh` 要：
  - 支援 `--repo`（指定 git root 目錄，預設 `$PWD`）
  - 支援 `--summary`（覆寫中文摘要）
  - 支援 `--explain`（輸出 debug 資訊：repo / scope / type / bump / matched-path）
  - 支援 `-h` / `--help`
  - source `../conventional_commit_rules.sh`（有備援預設陣列）
  - 根據 `git status --short --untracked-files=all` 掃描每個檔案，用 `CC_SCOPE_RULES` 比對
  - 選出「bump 層級最高」的檔案作為主建議；同層級時取規則索引最小者
  - 輸出格式：`type(scope): 中文摘要`
  - help / error 訊息用中文
  - `type(scope):` 維持英文

- `package.json` scripts 至少加上：
  - `"commit:suggest": "bash tool/suggest_commit_message.sh"`
  - `"commit:suggest:front": "bash tool/suggest_commit_message.sh --repo ../taiwan_brawl_front"`

請完成後：
- 跑 `bash -n deploy.sh`
- 跑 `bash -n tool/suggest_commit_message.sh`
- 跑 `npm run commit:suggest`
- 如果有前端 repo，再跑 `npm run commit:suggest:front`
- 回報修改的檔案與驗證結果
```

---

## 目前 Taiwan Brawl 的關鍵規則

### 1. 版本層級（低到高）

- `none` → 不升版
- `patch` → z+1
- `minor` → y+1, z=0
- `major` → x+1, y=0, z=0

### 2. Conventional Commit 對應

| type | bump |
|------|------|
| `feat` | `minor` |
| `fix` / `perf` / `refactor` | `patch` |
| `docs` / `test` / `build` / `ci` / `chore` / `style` / `revert` | `none` |
| `!` 後綴 或 body 含 `BREAKING CHANGE:` / `BREAKING-CHANGE:` | `major` |
| 無法辨識 | `none` |

### 3. 版本路徑規則（在 conventional_commit_rules.sh 管理）

#### Ignored（不計算 bump）

```
assets.json
pubspec.lock
package-lock.json
lib/constants/generated/locale_catalog.g.dart
```

#### Minor

```
migrations/*
src/royale_room*.js
src/royale_battle_rules.js
src/rooms_api.js
lib/pages/game/*
lib/models/*
lib/services/royale_*
web/*
```

#### Patch

```
deploy.sh
wrangler.jsonc
upload.js
tool/*
tests/*
assets/i18n/*
lib/constants/*
lib/services/*
lib/pages/*
src/*
pubspec.yaml
package.json
```

### 4. Commit 建議 scope 規則（CC_SCOPE_RULES）

格式：`"glob-pattern|scope|type|中文摘要"`

```
migrations/*                  | db       | feat     | 更新資料庫 schema
src/royale_room*.js           | royale   | refactor | 重整 Royale 房間運行邏輯
src/royale_battle_rules.js    | royale   | refactor | 調整 Royale 戰鬥規則
src/royale_room_proxy.js      | rooms    | refactor | 簡化房間代理流程
src/rooms_api.js              | rooms    | refactor | 重整房間 API 路由
src/friends_api.js            | friends  | fix      | 改善好友 API 流程
src/friends_repository.js     | friends  | fix      | 改善好友資料流程
src/admin_api.js              | admin    | fix      | 改善管理工具
src/request_helpers.js        | api      | refactor | 簡化 API 請求輔助工具
src/users.js                  | profile  | fix      | 改善個人資料流程
src/auth.js                   | auth     | fix      | 改善驗證流程
src/*                         | api      | fix      | 改善後端行為
tests/*                       | test     | test     | 補強自動化測試
tool/*                        | tooling  | chore    | 改善開發工具
deploy.sh                     | deploy   | chore    | 改善部署流程
wrangler.jsonc                | deploy   | chore    | 調整 Wrangler 設定
assets/i18n/*                 | i18n     | docs     | 更新翻譯資源
lib/pages/game/*              | game     | feat     | 更新遊戲體驗
lib/pages/social/*            | friends  | feat     | 更新社交體驗
lib/pages/profile/*           | profile  | feat     | 更新個人資料頁體驗
lib/pages/home/*              | home     | feat     | 更新首頁體驗
lib/services/royale_*         | royale   | refactor | 調整 Royale 服務流程
lib/services/*                | app      | fix      | 改善應用服務層
lib/constants/*               | i18n     | docs     | 更新語系資源
web/*                         | web      | feat     | 更新 Web 顯示內容
pubspec.yaml                  | app      | chore    | 更新前端依賴
*                             | app      | chore    | 更新專案檔案
```

同 bump 層級時，優先採用規則陣列中索引較小（較前面）的規則。

---

## 目前 Taiwan Brawl 的實際檔案參考

如果另一個 Codex 需要參考這份專案的實作風格，可以看：

- [deploy.sh](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/deploy.sh)
- [conventional_commit_rules.sh](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/conventional_commit_rules.sh)
- [tool/suggest_commit_message.sh](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/tool/suggest_commit_message.sh)
- [package.json](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/package.json)

---

## 建議交付標準

讓其他 Codex 完成後，至少要能做到：

```bash
bash -n deploy.sh
bash -n tool/suggest_commit_message.sh
npm run commit:suggest
```

如果有 sibling frontend repo，還要能做到：

```bash
npm run commit:suggest:front
```

另外 `deploy.sh` 應該要能在沒有 `VERSION` 時：

1. 從 `pubspec.yaml` 讀版本作為 base
2. 自動判斷 `none/patch/minor/major`
3. build + D1 migrations + KV upload + wrangler deploy
4. smoke tests 通過後，寫回新 semver 到 `pubspec.yaml`

---

## 補充建議

若 stack 和 Taiwan Brawl 不完全相同，請保留工具的核心行為，但把 path rules、smoke test routes、frontend 路徑、KV binding 名稱、D1 database name 依該專案做合理調整。

