#!/usr/bin/env bash

# Shared Conventional Commit rules for deploy version bumping
# and commit message suggestions.

CC_MINOR_TYPES=(
  feat
)

CC_PATCH_TYPES=(
  fix
  perf
  refactor
)

CC_NONE_TYPES=(
  docs
  test
  build
  ci
  chore
  style
  revert
)

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
