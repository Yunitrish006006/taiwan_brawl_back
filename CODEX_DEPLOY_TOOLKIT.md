# Codex Deploy Toolkit Spec

這份文件是給其他專案中的 Codex 使用的實作規格。  
目標是在「後端 repo + 同層 Flutter Web 前端 repo」的專案裡，重建和本專案相同的一套：

- `deploy.sh`
- `conventional_commit_rules.sh`
- `tool/suggest_commit_message.sh`
- `package.json` 內的 commit 建議 scripts

這套工具的核心特性是：

- `deploy.sh` 會自動做版本判定、前端 build、資產清單產生、KV 上傳、Workers deploy、smoke tests。
- 版本是純 `semver`，例如 `0.2.0`，不使用 `+build`。
- 版本判定優先看 `Conventional Commits`，沒有足夠訊息時再 fallback 到檔案路徑規則。
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

- `deploy.sh` 要支援：
  - `VERSION`
  - `WRANGLER_VERSION`
  - `VERSION_BUMP`
- `WRANGLER_VERSION` 預設使用最新版 `wrangler`。
- `deploy.sh` 需先嘗試自動找到 Flutter 前端目錄：
  - `$FRONTEND_DIR`
  - `../<frontend repo>`
  - `../front`
- 如果前端有 `tool/generate_locale_catalog.dart`，在 build 前先執行：
  - `dart run tool/generate_locale_catalog.dart`
- `deploy.sh` 版本規則要是純 semver，不要有 `+build`。
- `deploy.sh` 要讀前端 `pubspec.yaml` 的版本，並在 deploy 成功後把 `pubspec.yaml` 更新成本次 deploy 的版本。
- `deploy.sh` 的 `VERSION_BUMP=auto` 時要先看 Conventional Commits，再 fallback 檔案路徑規則。
- `Conventional Commits` 規則：
  - `feat` -> `minor`
  - `fix` / `perf` / `refactor` -> `patch`
  - `!` 或 `BREAKING CHANGE:` -> `major`
  - `docs` / `test` / `build` / `ci` / `chore` / `style` / `revert` -> `none`
- `deploy.sh` fallback 檔案路徑規則要支援：
  - ignored paths
  - minor paths
  - patch paths
  - 新增或刪除檔案時至少升到 `minor`
- `deploy.sh` 需做：
  1. locale catalog generation（如果存在）
  2. `flutter build web --release --build-name=<version>`
  3. `node upload.js`（如果存在）
  4. `wrangler kv bulk put assets.json --remote`
  5. `wrangler deploy`
  6. smoke tests
- smoke tests 至少檢查：
  - `/`
  - `/login`
  - `/api/health`，內容要包含 `"ok":true`
- `deploy.sh` 的輸出訊息使用英文。

- `conventional_commit_rules.sh` 要集中管理：
  - `CC_MINOR_TYPES`
  - `CC_PATCH_TYPES`
  - `CC_NONE_TYPES`
  - `CC_VERSION_IGNORED_PATHS`
  - `CC_VERSION_MINOR_PATHS`
  - `CC_VERSION_PATCH_PATHS`
  - `CC_SCOPE_RULES`

- `tool/suggest_commit_message.sh` 要：
  - 支援 `--repo`
  - 支援 `--summary`
  - 支援 `--explain`
  - 讀取 `conventional_commit_rules.sh`
  - 根據目前 repo 的 `git status --short --untracked-files=all` 產生一條建議的 Conventional Commit
  - 同 bump 層級時，優先採用規則檔中較前面的 rule
  - help / error 訊息用中文
  - commit 摘要用中文
  - `type(scope):` 維持英文以確保 version detection 正常

- `package.json` scripts 至少加上：
  - `commit:suggest`
  - `commit:suggest:front`

請完成後：
- 跑 `bash -n deploy.sh`
- 跑 `bash -n tool/suggest_commit_message.sh`
- 跑 `npm run commit:suggest`
- 如果有前端 repo，再跑 `npm run commit:suggest:front`
- 回報修改的檔案與驗證結果
```

---

## 目前 Taiwan Brawl 的關鍵規則

### 1. 版本層級

- `none`
- `patch`
- `minor`
- `major`

### 2. Conventional Commit 對應

- `feat` -> `minor`
- `fix` -> `patch`
- `perf` -> `patch`
- `refactor` -> `patch`
- `docs` -> `none`
- `test` -> `none`
- `build` -> `none`
- `ci` -> `none`
- `chore` -> `none`
- `style` -> `none`
- `revert` -> `none`
- `!` 或 `BREAKING CHANGE:` -> `major`

### 3. 版本路徑規則

#### Ignored

- `assets.json`
- `pubspec.lock`
- `package-lock.json`
- `lib/constants/generated/locale_catalog.g.dart`

#### Minor

- `migrations/*`
- `src/royale_room*.js`
- `src/royale_battle_rules.js`
- `src/rooms_api.js`
- `lib/pages/game/*`
- `lib/models/*`
- `lib/services/royale_*`
- `web/*`

#### Patch

- `deploy.sh`
- `wrangler.jsonc`
- `upload.js`
- `tool/*`
- `tests/*`
- `assets/i18n/*`
- `lib/constants/*`
- `lib/services/*`
- `lib/pages/*`
- `src/*`
- `pubspec.yaml`
- `package.json`

### 4. Commit 建議 scope 規則

目前用的是這類 rule：

```text
pattern | scope   | type      | chinese summary
--------|---------|-----------|-----------------------------
src/royale_room*.js      | royale  | refactor | 重整 Royale 房間運行邏輯
src/admin_api.js         | admin   | fix      | 改善管理工具
lib/pages/profile/*      | profile | feat     | 更新個人資料頁體驗
lib/pages/home/*         | home    | feat     | 更新首頁體驗
tool/*                   | tooling | chore    | 改善開發工具
*                        | app     | chore    | 更新專案檔案
```

Codex 在其他專案中應依該專案的模組命名，把這些 rule 換成對應的模組與摘要，但整體結構要保留。

---

## 目前 Taiwan Brawl 的實際檔案參考

如果另一個 Codex 需要參考這份專案的實作風格，可以看：

- [deploy.sh](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/deploy.sh)
- [conventional_commit_rules.sh](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/conventional_commit_rules.sh)
- [suggest_commit_message.sh](/Volumes/DataExtended/taiwan_brawl/taiwan_brawl_back/tool/suggest_commit_message.sh)
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

1. 從 `pubspec.yaml` 讀版本
2. 自動判斷 `none/patch/minor/major`
3. build + deploy
4. 寫回本次 deploy 的 semver 到 `pubspec.yaml`

---

## 補充建議

如果你想讓另一個 Codex 做得更像這份專案，可以再加一句：

> 若 stack 和 Taiwan Brawl 不完全相同，請保留工具的核心行為，但把 path rules、smoke test routes、frontend 路徑、KV binding 名稱依該專案做合理調整。

