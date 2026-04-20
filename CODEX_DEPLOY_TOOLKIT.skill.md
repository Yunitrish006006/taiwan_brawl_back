---
name: codex-deploy-toolkit
description: Builds the Taiwan Brawl-style deploy/version/commit toolkit for a Cloudflare Workers backend + Flutter Web frontend project. Use this skill when asked to set up deploy automation, version bumping, or commit message suggestion scripts in a new project.
---

# Codex Deploy Toolkit

## Purpose

Set up a complete deploy, versioning, and commit suggestion toolkit for a project with a Cloudflare Workers backend and a sibling Flutter Web frontend repo. The toolkit consists of:

- `deploy.sh` — end-to-end deploy pipeline with auto version bump
- `conventional_commit_rules.sh` — centralized rules for versioning and commit scopes
- `tool/suggest_commit_message.sh` — CLI tool that suggests a Conventional Commit message based on `git status`
- `package.json` scripts — `commit:suggest` and `commit:suggest:front`

---

## Files to Create or Update

### 1. `conventional_commit_rules.sh`

Central rules file sourced by both `deploy.sh` and `suggest_commit_message.sh`.

```bash
#!/usr/bin/env bash

CC_MINOR_TYPES=(feat)
CC_PATCH_TYPES=(fix perf refactor)
CC_NONE_TYPES=(docs test build ci chore style revert)

CC_VERSION_IGNORED_PATHS=(
  assets.json
  pubspec.lock
  package-lock.json
  lib/constants/generated/locale_catalog.g.dart
)

CC_VERSION_MINOR_PATHS=(
  migrations/*
  src/royale_room*.js
  src/royale_battle_rules.js
  src/rooms_api.js
  lib/pages/game/*
  lib/models/*
  lib/services/royale_*
  web/*
)

CC_VERSION_PATCH_PATHS=(
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
)

# Format: "glob-pattern|scope|type|中文摘要"
# Lower index = higher priority when bump level ties.
CC_SCOPE_RULES=(
  "migrations/*|db|feat|更新資料庫 schema"
  "src/royale_room*.js|royale|refactor|重整 Royale 房間運行邏輯"
  "src/royale_battle_rules.js|royale|refactor|調整 Royale 戰鬥規則"
  "src/royale_room_proxy.js|rooms|refactor|簡化房間代理流程"
  "src/rooms_api.js|rooms|refactor|重整房間 API 路由"
  "src/friends_api.js|friends|fix|改善好友 API 流程"
  "src/friends_repository.js|friends|fix|改善好友資料流程"
  "src/admin_api.js|admin|fix|改善管理工具"
  "src/request_helpers.js|api|refactor|簡化 API 請求輔助工具"
  "src/users.js|profile|fix|改善個人資料流程"
  "src/auth.js|auth|fix|改善驗證流程"
  "src/*|api|fix|改善後端行為"
  "tests/*|test|test|補強自動化測試"
  "tool/*|tooling|chore|改善開發工具"
  "deploy.sh|deploy|chore|改善部署流程"
  "wrangler.jsonc|deploy|chore|調整 Wrangler 設定"
  "assets/i18n/*|i18n|docs|更新翻譯資源"
  "lib/pages/game/*|game|feat|更新遊戲體驗"
  "lib/pages/social/*|friends|feat|更新社交體驗"
  "lib/pages/profile/*|profile|feat|更新個人資料頁體驗"
  "lib/pages/home/*|home|feat|更新首頁體驗"
  "lib/services/royale_*|royale|refactor|調整 Royale 服務流程"
  "lib/services/*|app|fix|改善應用服務層"
  "lib/constants/*|i18n|docs|更新語系資源"
  "web/*|web|feat|更新 Web 顯示內容"
  "pubspec.yaml|app|chore|更新前端依賴"
  "*|app|chore|更新專案檔案"
)
```

**Important:** Adapt `CC_SCOPE_RULES`, `CC_VERSION_MINOR_PATHS`, and `CC_VERSION_PATCH_PATHS` to match the actual module structure of the target project.

---

### 2. `deploy.sh`

#### Supported environment variable overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `VERSION` | *(auto)* | Skip auto bump, use this exact semver |
| `VERSION_BUMP` | `auto` | `auto\|major\|minor\|patch\|none` |
| `WRANGLER_VERSION` | `latest` | Pinned wrangler version |
| `FRONTEND_DIR` | *(auto-detect)* | Path to Flutter frontend repo |
| `FLUTTER_BIN_DIR` | *(auto-detect)* | Path to Flutter SDK `bin/` |
| `D1_DATABASE_NAME` | *(from wrangler.jsonc)* | D1 database name |
| `KV_NAMESPACE_ID` | *(from wrangler.jsonc)* | KV namespace id for `STATIC_ASSETS` |
| `DEPLOY_BASE_URL` | *(from wrangler.jsonc name)* | Base URL for smoke tests |

#### Frontend directory auto-detection order
1. `$FRONTEND_DIR`
2. `../<project>_front` (sibling named after this repo)
3. `../front`

#### Flutter SDK auto-detection order
1. `$FLUTTER_BIN_DIR`
2. Directory of `command -v flutter`
3. `/Volumes/DataExtended/flutter/bin`
4. `~/flutter/bin`
5. `~/development/flutter/bin`

#### `VERSION_BUMP=auto` logic
1. Find the epoch of the last `git commit` that touched `pubspec.yaml` as **anchor**.
2. Run `git log --since=@<anchor>` on both backend and frontend repos; parse Conventional Commit subjects and bodies.
3. Also scan **currently unstaged/uncommitted** files via `git status` on both repos against path rules.
4. Take the **highest** bump level across all four sources.

#### Version bump rules

| Source | Rule | Bump |
|--------|------|------|
| Conventional Commit | `feat` | `minor` |
| Conventional Commit | `fix` / `perf` / `refactor` | `patch` |
| Conventional Commit | `docs`/`test`/`build`/`ci`/`chore`/`style`/`revert` | `none` |
| Conventional Commit | `!` suffix or body has `BREAKING CHANGE:`/`BREAKING-CHANGE:` | `major` |
| Conventional Commit | unrecognised type | `none` |
| Path rule | minor paths | `minor` |
| Path rule | patch paths | `patch` |
| Path rule | file Added or Deleted (not ignored) | `minor` |
| Path rule | ignored paths | skip |

#### Deploy pipeline steps

```
[1/5]   locale catalog generation (dart run tool/generate_locale_catalog.dart, if exists)
[2/5]   flutter build web --release --build-name=<version>
[3/5]   node upload.js (if exists)
[3.5/6] npm ci / npm install (if backend node_modules incomplete)
[4/6]   wrangler d1 migrations apply <db> --remote (if migrations/ exists)
[5/6]   wrangler kv bulk put assets.json --namespace-id <id> --remote (if assets.json exists)
[6/6]   wrangler deploy
[6.5/6] smoke tests
        - GET /        → HTTP 200
        - GET /login   → HTTP 200
        - GET /api/health → body contains "ok":true
```

After all steps pass: write the new semver back to `pubspec.yaml` using `awk`.

#### Wrangler invocation pattern

Always use `npm exec --package=wrangler@<version> --` to ensure the pinned version is used.

#### Security note

At the very top of `deploy.sh`, unset `NODE_TLS_REJECT_UNAUTHORIZED` if it equals `"0"` to prevent accidental TLS bypass.

---

### 3. `tool/suggest_commit_message.sh`

#### CLI options

| Option | Description |
|--------|-------------|
| `--repo <path>` | Target git root (default: `$PWD`) |
| `--summary <text>` | Override the Chinese summary |
| `--explain` | Print debug info (repo / scope / type / bump / matched-path) |
| `-h` / `--help` | Show usage in Chinese |

#### Algorithm
1. Source `../conventional_commit_rules.sh` (with fallback defaults).
2. Run `git status --short --untracked-files=all` on the target repo.
3. For each changed file, match against `CC_SCOPE_RULES` in order.
4. Pick the file whose matched rule produces the **highest bump level**.
5. On tie, prefer the rule with the **smaller index** (earlier in the array).
6. Output: `type(scope): 中文摘要`

#### Output format

```
feat(game): 更新遊戲體驗
```

- `type(scope):` is always English (required for version detection to work).
- Summary is always Chinese.

---

### 4. `package.json` scripts

```json
"commit:suggest": "bash tool/suggest_commit_message.sh",
"commit:suggest:front": "bash tool/suggest_commit_message.sh --repo ../taiwan_brawl_front"
```

---

## Validation Checklist

After generating all files, run:

```bash
bash -n deploy.sh
bash -n tool/suggest_commit_message.sh
npm run commit:suggest
npm run commit:suggest:front   # if frontend repo exists
```

All four commands must exit 0 with no syntax errors.

---

## Tips

- The `deploy.sh` step numbers jump from `[3/5]` to `[3.5/6]` to `[4/6]` — this is intentional and matches the original project's style. Do not "fix" it.
- `CC_SCOPE_RULES` order matters. Rules matched earlier take precedence on tie. Put more specific globs before wildcards.
- When adapting to a different stack: keep the helper functions (`version_bump_rank`, `max_version_bump`, `bump_semver`, `path_matches_patterns`, `array_contains`) verbatim — they are correct and tested.
- D1 and KV ids are read from `wrangler.jsonc` at runtime using inline `node -e` expressions. Do not hardcode them in `deploy.sh`.
- The `pubspec.yaml` version write-back uses `awk` to replace only the first `version:` line and writes to a temp file before `mv` — preserve this pattern to avoid partial-write corruption.
