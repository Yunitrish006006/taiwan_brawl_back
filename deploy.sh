#!/usr/bin/env bash
set -euo pipefail

if [[ "${NODE_TLS_REJECT_UNAUTHORIZED:-}" == "0" ]]; then
  echo "Clearing insecure NODE_TLS_REJECT_UNAUTHORIZED=0 override"
  unset NODE_TLS_REJECT_UNAUTHORIZED
fi

# Optional overrides:
# export VERSION="0.1.0"
# export WRANGLER_VERSION="4.78.0"
# export VERSION_BUMP="auto" # auto|major|minor|patch|none
# export AUTO_COMMIT="1" # 1=true, 0=false
# export AUTO_COMMIT_BACKEND_MESSAGE="chore(deploy): release 0.1.0"
# export AUTO_COMMIT_FRONTEND_MESSAGE="chore(app): release 0.1.0"
# export AUTO_PUSH="1" # 1=true, 0=false (requires AUTO_COMMIT=1)
# export EXIT_PROMPT="0" # 1=show final Enter prompt, 0=skip

WRANGLER_VERSION="${WRANGLER_VERSION:-latest}"
VERSION_BUMP="${VERSION_BUMP:-auto}"
AUTO_COMMIT="${AUTO_COMMIT:-0}"
AUTO_PUSH="${AUTO_PUSH:-0}"
EXIT_PROMPT="${EXIT_PROMPT:-1}"
CC_MINOR_TYPES=(feat)
CC_PATCH_TYPES=(fix perf refactor)
CC_NONE_TYPES=(docs test build ci chore style revert)
CC_VERSION_IGNORED_PATHS=(assets.json pubspec.lock package-lock.json lib/constants/generated/locale_catalog.g.dart)
CC_VERSION_MINOR_PATHS=(migrations/* src/royale_room*.js src/royale_battle_rules.js src/rooms_api.js lib/pages/game/* lib/models/* lib/services/royale_* web/*)
CC_VERSION_PATCH_PATHS=(deploy.sh wrangler.jsonc upload.js tool/* tests/* assets/i18n/* lib/constants/* lib/services/* lib/pages/* src/* pubspec.yaml package.json)

version_bump_rank() {
  case "$1" in
    none) echo 0 ;;
    patch) echo 1 ;;
    minor) echo 2 ;;
    major) echo 3 ;;
    *) echo 0 ;;
  esac
}

max_version_bump() {
  local left_rank right_rank
  left_rank="$(version_bump_rank "$1")"
  right_rank="$(version_bump_rank "$2")"
  if (( right_rank > left_rank )); then
    printf '%s\n' "$2"
  else
    printf '%s\n' "$1"
  fi
}

normalize_version_bump() {
  case "$1" in
    auto|major|minor|patch|none) printf '%s\n' "$1" ;;
    *) printf 'auto\n' ;;
  esac
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "${item}" == "${needle}" ]]; then
      return 0
    fi
  done
  return 1
}

path_matches_patterns() {
  local path="$1"
  shift
  local pattern
  for pattern in "$@"; do
    case "${path}" in
      ${pattern}) return 0 ;;
    esac
  done
  return 1
}

commit_message_version_bump() {
  local subject="$1"
  local body="$2"
  local type breaking=""
  local conventional_regex='^([A-Za-z]+)(\([^)]+\))?(!)?:[[:space:]]'

  if [[ "${subject}" =~ ${conventional_regex} ]]; then
    type="${BASH_REMATCH[1],,}"
    breaking="${BASH_REMATCH[3]:-}"
  else
    printf 'none\n'
    return 0
  fi

  if [[ -n "${breaking}" || "${body}" == *"BREAKING CHANGE:"* || "${body}" == *"BREAKING-CHANGE:"* ]]; then
    printf 'major\n'
    return 0
  fi

  if array_contains "${type}" "${CC_MINOR_TYPES[@]}"; then
    printf 'minor\n'
  elif array_contains "${type}" "${CC_PATCH_TYPES[@]}"; then
    printf 'patch\n'
  elif array_contains "${type}" "${CC_NONE_TYPES[@]}"; then
    printf 'none\n'
  else
    printf 'none\n'
  fi
}

bump_semver() {
  local version="$1"
  local bump="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "${version}"
  major="${major:-0}"
  minor="${minor:-0}"
  patch="${patch:-0}"

  case "${bump}" in
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    patch)
      patch=$((patch + 1))
      ;;
  esac

  printf '%s.%s.%s\n' "${major}" "${minor}" "${patch}"
}

resolve_git_root() {
  local directory="$1"
  git -C "${directory}" rev-parse --show-toplevel 2>/dev/null || true
}

resolve_version_anchor_epoch() {
  local git_root
  git_root="$(resolve_git_root "${FRONTEND_DIR}")"
  if [[ -z "${git_root}" ]]; then
    return 0
  fi

  git -C "${git_root}" log -n1 --format=%ct -- pubspec.yaml 2>/dev/null || true
}

is_ignored_version_path() {
  path_matches_patterns "$1" "${CC_VERSION_IGNORED_PATHS[@]}"
}

is_minor_change_path() {
  path_matches_patterns "$1" "${CC_VERSION_MINOR_PATHS[@]}"
}

is_patch_change_path() {
  path_matches_patterns "$1" "${CC_VERSION_PATCH_PATHS[@]}"
}

detect_repo_version_bump() {
  local repo_dir="$1"
  local git_root
  git_root="$(resolve_git_root "${repo_dir}")"
  if [[ -z "${git_root}" ]]; then
    return 0
  fi

  local line status path trimmed_path detected_bump="none"
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    status="${line:0:2}"
    path="${line:3}"
    trimmed_path="${path##* -> }"

    if is_ignored_version_path "${trimmed_path}"; then
      continue
    fi

    if is_minor_change_path "${trimmed_path}"; then
      detected_bump="$(max_version_bump "${detected_bump}" "minor")"
      continue
    fi

    if [[ "${status}" == *"A"* || "${status}" == *"D"* ]]; then
      detected_bump="$(max_version_bump "${detected_bump}" "minor")"
      continue
    fi

    if is_patch_change_path "${trimmed_path}"; then
      detected_bump="$(max_version_bump "${detected_bump}" "patch")"
    fi
  done < <(git -C "${git_root}" status --short --untracked-files=all)

  printf '%s\n' "${detected_bump}"
}

detect_repo_commit_version_bump() {
  local repo_dir="$1"
  local since_epoch="$2"
  local git_root
  git_root="$(resolve_git_root "${repo_dir}")"
  if [[ -z "${git_root}" || -z "${since_epoch}" ]]; then
    printf 'none\n'
    return 0
  fi

  local detected_bump="none"
  local record subject body commit_bump
  while IFS= read -r -d $'\x1e' record; do
    [[ -z "${record}" ]] && continue
    subject="${record%%$'\x1f'*}"
    body="${record#*$'\x1f'}"
    if [[ "${body}" == "${record}" ]]; then
      body=""
    fi
    commit_bump="$(commit_message_version_bump "${subject}" "${body}")"
    detected_bump="$(max_version_bump "${detected_bump}" "${commit_bump}")"
  done < <(git -C "${git_root}" log --format='%s%x1f%b%x1e' --since="@${since_epoch}" && printf '\x1e')

  printf '%s\n' "${detected_bump}"
}

detect_auto_version_bump() {
  local anchor_epoch commit_backend_bump commit_frontend_bump path_backend_bump path_frontend_bump detected_bump="none"
  anchor_epoch="$(resolve_version_anchor_epoch)"

  commit_backend_bump="$(detect_repo_commit_version_bump "${BACKEND_DIR}" "${anchor_epoch}")"
  commit_frontend_bump="$(detect_repo_commit_version_bump "${FRONTEND_DIR}" "${anchor_epoch}")"
  path_backend_bump="$(detect_repo_version_bump "${BACKEND_DIR}" | tail -n1)"
  path_frontend_bump="$(detect_repo_version_bump "${FRONTEND_DIR}" | tail -n1)"

  detected_bump="$(max_version_bump "${detected_bump}" "${commit_backend_bump}")"
  detected_bump="$(max_version_bump "${detected_bump}" "${commit_frontend_bump}")"
  detected_bump="$(max_version_bump "${detected_bump}" "${path_backend_bump}")"
  detected_bump="$(max_version_bump "${detected_bump}" "${path_frontend_bump}")"

  printf '%s\n' "${detected_bump}"
}

resolve_version_bump() {
  local requested_bump normalized_bump
  requested_bump="$1"
  normalized_bump="$(normalize_version_bump "${requested_bump}")"

  case "${normalized_bump}" in
    auto)
      detect_auto_version_bump
      ;;
    *)
      printf '%s\n' "${normalized_bump}"
      ;;
  esac
}

resolve_wrangler_package() {
  if [[ "${WRANGLER_VERSION}" != "latest" ]]; then
    printf 'wrangler@%s\n' "${WRANGLER_VERSION}"
    return 0
  fi

  local resolved_version
  resolved_version="$(npm view wrangler version 2>/dev/null || true)"
  if [[ -n "${resolved_version}" ]]; then
    printf 'wrangler@%s\n' "${resolved_version}"
  else
    printf 'wrangler@latest\n'
  fi
}

run_wrangler() {
  npm exec --package="${WRANGLER_PACKAGE}" -- wrangler "$@"
}

looks_like_auth_expired() {
  local message="$1"
  local lower
  lower="$(printf '%s' "${message}" | tr '[:upper:]' '[:lower:]')"

  case "${lower}" in
    *"token"*"expired"*|*"authentication"*|*"unauthorized"*|*"not logged in"*|*"login required"*|*"invalid api token"*)
      return 0
      ;;
  esac

  return 1
}

ensure_cloudflare_auth() {
  local whoami_output
  if whoami_output="$(run_wrangler whoami 2>&1)"; then
    echo "Cloudflare auth check passed"
    return 0
  fi

  if ! looks_like_auth_expired "${whoami_output}"; then
    echo "Cloudflare auth check failed for a non-auth reason:"
    echo "${whoami_output}"
    return 1
  fi

  if [[ ! -f "${LOGOUT_LOGIN_SCRIPT}" ]]; then
    echo "Cloudflare token appears expired, but ${LOGOUT_LOGIN_SCRIPT} was not found."
    return 1
  fi

  echo "Cloudflare token appears expired. Re-authenticating via logout_and_login.sh..."
  bash "${LOGOUT_LOGIN_SCRIPT}"

  if whoami_output="$(run_wrangler whoami 2>&1)"; then
    echo "Cloudflare re-authentication succeeded"
    return 0
  fi

  echo "Cloudflare re-authentication failed:"
  echo "${whoami_output}"
  return 1
}

WRANGLER_PACKAGE="$(resolve_wrangler_package)"
REQUIRED_BACKEND_PACKAGES=("@cloudflare/kv-asset-handler" "web-push")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES_FILE="${SCRIPT_DIR}/conventional_commit_rules.sh"
if [[ -f "${RULES_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${RULES_FILE}"
fi
LOGOUT_LOGIN_SCRIPT="${SCRIPT_DIR}/logout_and_login.sh"

resolve_frontend_dir() {
  if [[ -n "${FRONTEND_DIR:-}" ]]; then
    printf '%s\n' "${FRONTEND_DIR}"
    return 0
  fi

  local candidates=(
    "${SCRIPT_DIR}/../taiwan_brawl_front"
    "${SCRIPT_DIR}/../front"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}/pubspec.yaml" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  echo "Unable to locate Flutter frontend directory." >&2
  echo "Set FRONTEND_DIR or place the app at ../taiwan_brawl_front or ../front" >&2
  exit 1
}

resolve_flutter_bin_dir() {
  if [[ -n "${FLUTTER_BIN_DIR:-}" && -x "${FLUTTER_BIN_DIR}/flutter" && -x "${FLUTTER_BIN_DIR}/dart" ]]; then
    printf '%s\n' "${FLUTTER_BIN_DIR}"
    return 0
  fi

  local resolved_flutter candidate
  resolved_flutter="$(command -v flutter 2>/dev/null || true)"
  local candidates=(
    "/Volumes/DataExtended/flutter/bin"
    "${HOME}/flutter/bin"
    "${HOME}/development/flutter/bin"
  )

  if [[ -n "${resolved_flutter}" ]]; then
    candidates=(
      "$(dirname "${resolved_flutter}")"
      "${candidates[@]}"
    )
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -n "${candidate}" && -x "${candidate}/flutter" && -x "${candidate}/dart" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  echo "Unable to locate Flutter SDK bin directory." >&2
  echo "Set FLUTTER_BIN_DIR or install Flutter under /Volumes/DataExtended/flutter/bin" >&2
  exit 1
}

backend_dependencies_installed() {
  npm ls --depth=0 "${REQUIRED_BACKEND_PACKAGES[@]}" >/dev/null 2>&1
}

ensure_backend_dependencies() {
  if backend_dependencies_installed; then
    echo "Backend dependencies already installed"
    return 0
  fi

  local install_cmd
  if [[ -f "${BACKEND_DIR}/package-lock.json" ]]; then
    install_cmd="npm ci"
  else
    install_cmd="npm install"
  fi

  echo "[3.5/6] Installing backend dependencies..."
  echo "Running: ${install_cmd}"
  ${install_cmd}
  echo "Backend dependencies ready"
}

ensure_workspace_and_environment() {
  if [[ ! -f "${BACKEND_DIR}/package.json" || ! -f "${BACKEND_DIR}/wrangler.jsonc" ]]; then
    echo "Backend repo check failed. Expected package.json and wrangler.jsonc in ${BACKEND_DIR}"
    exit 1
  fi

  if [[ ! -f "${FRONTEND_DIR}/pubspec.yaml" ]]; then
    echo "Frontend repo check failed. Expected pubspec.yaml in ${FRONTEND_DIR}"
    exit 1
  fi

  if [[ ! -x "${FLUTTER_BIN_DIR}/flutter" || ! -x "${FLUTTER_BIN_DIR}/dart" ]]; then
    echo "Flutter SDK check failed. Expected flutter and dart in ${FLUTTER_BIN_DIR}"
    exit 1
  fi

  echo "Workspace check passed: backend + frontend + Flutter environment"
}

auto_commit_repo_if_needed() {
  local repo_dir="$1"
  local commit_message="$2"
  local repo_label="$3"
  local git_root status_output

  git_root="$(resolve_git_root "${repo_dir}")"
  if [[ -z "${git_root}" ]]; then
    echo "Skip ${repo_label} auto commit: not a git repository (${repo_dir})"
    return 0
  fi

  status_output="$(git -C "${git_root}" status --short --untracked-files=all)"
  if [[ -z "${status_output}" ]]; then
    echo "Skip ${repo_label} auto commit: no changes"
    return 0
  fi

  echo "Auto committing ${repo_label} changes at ${git_root}"
  git -C "${git_root}" add -A

  if git -C "${git_root}" diff --cached --quiet; then
    echo "Skip ${repo_label} auto commit: no staged changes"
    return 0
  fi

  git -C "${git_root}" commit -m "${commit_message}"

  case "${repo_label}" in
    backend)
      BACKEND_AUTO_COMMITTED=1
      BACKEND_GIT_ROOT="${git_root}"
      ;;
    frontend)
      FRONTEND_AUTO_COMMITTED=1
      FRONTEND_GIT_ROOT="${git_root}"
      ;;
  esac
}

auto_commit_after_deploy() {
  if ! is_truthy "${AUTO_COMMIT}"; then
    echo "Auto commit disabled (set AUTO_COMMIT=1 to enable)"
    return 0
  fi

  local backend_message frontend_message
  backend_message="${AUTO_COMMIT_BACKEND_MESSAGE:-chore(deploy): release ${VERSION}}"
  frontend_message="${AUTO_COMMIT_FRONTEND_MESSAGE:-chore(app): release ${VERSION}}"

  auto_commit_repo_if_needed "${BACKEND_DIR}" "${backend_message}" "backend"
  auto_commit_repo_if_needed "${FRONTEND_DIR}" "${frontend_message}" "frontend"
}

auto_push_after_deploy() {
  if ! is_truthy "${AUTO_PUSH}"; then
    echo "Auto push disabled (set AUTO_PUSH=1 to enable)"
    return 0
  fi

  if ! is_truthy "${AUTO_COMMIT}"; then
    echo "Skip auto push: AUTO_PUSH requires AUTO_COMMIT=1"
    return 0
  fi

  if [[ "${BACKEND_AUTO_COMMITTED:-0}" == "1" && -n "${BACKEND_GIT_ROOT:-}" ]]; then
    echo "Auto pushing backend changes from ${BACKEND_GIT_ROOT}"
    git -C "${BACKEND_GIT_ROOT}" push
  else
    echo "Skip backend auto push: no backend commit created in this deploy"
  fi

  if [[ "${FRONTEND_AUTO_COMMITTED:-0}" == "1" && -n "${FRONTEND_GIT_ROOT:-}" ]]; then
    echo "Auto pushing frontend changes from ${FRONTEND_GIT_ROOT}"
    git -C "${FRONTEND_GIT_ROOT}" push
  else
    echo "Skip frontend auto push: no frontend commit created in this deploy"
  fi
}

FRONTEND_DIR="$(resolve_frontend_dir)"
FLUTTER_BIN_DIR="$(resolve_flutter_bin_dir)"
export PATH="${FLUTTER_BIN_DIR}:${PATH}"
PUBSPEC="${FRONTEND_DIR}/pubspec.yaml"
BACKEND_DIR="${SCRIPT_DIR}"
ASSETS_PATH="${BACKEND_DIR}/assets.json"
UPLOAD_SCRIPT="${BACKEND_DIR}/upload.js"
WRANGLER_CONFIG="${BACKEND_DIR}/wrangler.jsonc"
MIGRATIONS_DIR="${BACKEND_DIR}/migrations"
LOCALE_GENERATOR="${FRONTEND_DIR}/tool/generate_locale_catalog.dart"

VERSION="${VERSION:-}"
BACKEND_AUTO_COMMITTED=0
FRONTEND_AUTO_COMMITTED=0
BACKEND_GIT_ROOT=""
FRONTEND_GIT_ROOT=""
FULL_VER="$(sed -nE 's/^version:[[:space:]]*([^[:space:]]+).*/\1/p' "${PUBSPEC}" | head -n1)"
if [[ -z "${FULL_VER}" ]]; then
  echo "Failed to read version from ${PUBSPEC}"
  exit 1
fi

BASE_VERSION="${FULL_VER%%+*}"

RESOLVED_VERSION_BUMP="none"
if [[ -n "${VERSION}" ]]; then
  RESOLVED_VERSION_BUMP="manual"
else
  RESOLVED_VERSION_BUMP="$(resolve_version_bump "${VERSION_BUMP}")"
  VERSION="$(bump_semver "${BASE_VERSION}" "${RESOLVED_VERSION_BUMP}")"
fi

echo "======================================"
echo "Taiwan Brawl Auto Deployment"
echo "Version: ${VERSION}"
echo "Version bump: ${RESOLVED_VERSION_BUMP} (base ${BASE_VERSION})"
echo "Frontend: ${FRONTEND_DIR}"
echo "Flutter SDK: ${FLUTTER_BIN_DIR}"
echo "Wrangler: ${WRANGLER_PACKAGE}"
echo "======================================"
echo

echo "[0/6] Running preflight checks..."
ensure_workspace_and_environment
ensure_cloudflare_auth
echo "Preflight checks completed"
echo

echo "[1/5] Generating locale catalog..."
cd "${FRONTEND_DIR}"
if [[ -f "${LOCALE_GENERATOR}" ]]; then
  CMD="dart run tool/generate_locale_catalog.dart"
  echo "Running: ${CMD}"
  dart run tool/generate_locale_catalog.dart
  echo "Step 1 completed"
else
  echo "Locale generator not found, skipping catalog generation"
fi
echo

echo "[2/5] Building Flutter Frontend..."
CMD="flutter build web --release --build-name=${VERSION}"
echo "Running: ${CMD}"
flutter build web --release --build-name="${VERSION}"
echo "Step 2 completed"
echo

echo "[3/5] Generating asset list..."
cd "${BACKEND_DIR}"
if [[ -f "${UPLOAD_SCRIPT}" ]]; then
  node "${UPLOAD_SCRIPT}"
  echo "Step 3 completed"
else
  echo "upload.js not found, skipping asset generation"
fi
echo

ensure_backend_dependencies
echo

echo "[4/6] Applying D1 migrations..."
if [[ -d "${MIGRATIONS_DIR}" ]]; then
  DETECTED_D1_DATABASE_NAME="$(node -e "const fs=require('node:fs');const p='${WRANGLER_CONFIG}';try{const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const db=(cfg.d1_databases||[])[0];process.stdout.write(db?.database_name||'');}catch{process.stdout.write('');}")"
  D1_TARGET_DATABASE_NAME="${D1_DATABASE_NAME:-${DETECTED_D1_DATABASE_NAME}}"

  if [[ -z "${D1_TARGET_DATABASE_NAME}" ]]; then
    echo "No D1 database name found. Set D1_DATABASE_NAME or configure d1_databases in wrangler.jsonc"
    exit 1
  else
    echo "databaseName: ${D1_TARGET_DATABASE_NAME}"
    echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler d1 migrations apply ${D1_TARGET_DATABASE_NAME} --remote"
    run_wrangler d1 migrations apply "${D1_TARGET_DATABASE_NAME}" --remote
    echo "Step 4 completed"
  fi
else
  echo "migrations directory not found, skipping D1 migrations"
fi
echo

echo "[5/6] Uploading static files to KV..."
if [[ -f "${ASSETS_PATH}" ]]; then
  DETECTED_KV_NAMESPACE_ID="$(node -e "const fs=require('node:fs');const p='${WRANGLER_CONFIG}';try{const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const ns=(cfg.kv_namespaces||[]).find(n=>n.binding==='STATIC_ASSETS');process.stdout.write(ns?.id||'');}catch{process.stdout.write('');}")"
  KV_TARGET_NAMESPACE_ID="${KV_NAMESPACE_ID:-${DETECTED_KV_NAMESPACE_ID}}"

  if [[ -z "${KV_TARGET_NAMESPACE_ID}" ]]; then
    echo "No KV namespace id found. Set KV_NAMESPACE_ID or configure STATIC_ASSETS in wrangler.jsonc"
    exit 1
  else
    echo "assetsPath: ${ASSETS_PATH}"
    echo "namespaceId: ${KV_TARGET_NAMESPACE_ID}"
    echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler kv bulk put ${ASSETS_PATH} --namespace-id ${KV_TARGET_NAMESPACE_ID} --remote"
    run_wrangler kv bulk put "${ASSETS_PATH}" --namespace-id "${KV_TARGET_NAMESPACE_ID}" --remote
    echo "Step 5 completed"
  fi
else
  echo "assets.json not found, skipping KV upload"
fi
echo

echo "[6/6] Deploying Workers..."
echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler deploy"
run_wrangler deploy
echo "Step 6 completed"
echo

echo "[6.5/6] Running smoke tests..."
BASE_URL="${DEPLOY_BASE_URL:-https://taiwan-brawl-api.yunitrish0419.workers.dev}"
echo "Testing base URL: ${BASE_URL}"

ROOT_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/")"
LOGIN_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/login")"
HEALTH_JSON="$(curl -s "${BASE_URL}/api/health")"

if [[ "${ROOT_STATUS}" != "200" ]]; then
  echo "Smoke test failed: / returned ${ROOT_STATUS}"
  exit 1
fi

if [[ "${LOGIN_STATUS}" != "200" ]]; then
  echo "Smoke test failed: /login returned ${LOGIN_STATUS}"
  exit 1
fi

if [[ "${HEALTH_JSON}" != *'"ok":true'* ]]; then
  echo "Smoke test failed: /api/health returned unexpected payload"
  echo "Response: ${HEALTH_JSON}"
  exit 1
fi

echo "Smoke tests passed"
echo

echo "======================================"
echo "Deployment successful! Version: ${VERSION}"
echo "Access: https://taiwan-brawl-api.yunitrish0419.workers.dev"
echo "======================================"
echo

echo "Updating pubspec version..."

TMP_FILE="$(mktemp)"
awk -v new_version="${VERSION}" '
  BEGIN { replaced = 0 }
  {
    if (!replaced && $0 ~ /^version:[[:space:]]*[^[:space:]]+/) {
      print "version: " new_version
      replaced = 1
    } else {
      print
    }
  }
  END {
    if (!replaced) {
      print "version: " new_version
    }
  }
' "${PUBSPEC}" > "${TMP_FILE}"
mv "${TMP_FILE}" "${PUBSPEC}"

echo "Pubspec version is now: ${VERSION}"
echo
echo "[7/6] Auto commit after deploy..."
auto_commit_after_deploy
echo

echo "[7.5/6] Auto push after deploy..."
auto_push_after_deploy
echo

if [[ -t 0 ]] && is_truthy "${EXIT_PROMPT}"; then
  read -r -p "Press Enter to exit" _
fi
