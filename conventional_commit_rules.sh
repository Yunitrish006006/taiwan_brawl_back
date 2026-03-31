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
  "migrations/*|db|feat|update database schema"
  "src/royale_room*.js|royale|refactor|reorganize royale room runtime"
  "src/royale_battle_rules.js|royale|refactor|refine royale battle rules"
  "src/royale_room_proxy.js|rooms|refactor|simplify room proxy flow"
  "src/rooms_api.js|rooms|refactor|reorganize room API routes"
  "src/friends_api.js|friends|fix|improve friends API flow"
  "src/friends_repository.js|friends|fix|improve friends data flow"
  "src/admin_api.js|admin|fix|improve admin tooling"
  "src/request_helpers.js|api|refactor|simplify API request helpers"
  "src/users.js|profile|fix|improve profile data flow"
  "src/auth.js|auth|fix|improve authentication flow"
  "src/*|api|fix|improve backend behavior"
  "tests/*|test|test|expand automated coverage"
  "tool/*|tooling|chore|improve developer tooling"
  "deploy.sh|deploy|chore|improve deployment workflow"
  "wrangler.jsonc|deploy|chore|adjust wrangler configuration"
  "assets/i18n/*|i18n|docs|update translations"
  "lib/pages/game/*|game|feat|update gameplay experience"
  "lib/pages/social/*|friends|feat|update social experience"
  "lib/pages/profile/*|profile|feat|update profile experience"
  "lib/pages/home/*|home|feat|update home experience"
  "lib/services/royale_*|royale|refactor|refine royale service flow"
  "lib/services/*|app|fix|improve app service layer"
  "lib/constants/*|i18n|docs|update localization resources"
  "web/*|web|feat|update web presentation"
  "pubspec.yaml|app|chore|update frontend dependencies"
  "*|app|chore|update project files"
)
