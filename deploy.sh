#!/usr/bin/env bash
set -euo pipefail

# Optional overrides:
# export VERSION="0.1.0"
# export BUILD_NUMBER="1"

WRANGLER_VERSION="4.72.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

FRONTEND_DIR="$(resolve_frontend_dir)"
PUBSPEC="${FRONTEND_DIR}/pubspec.yaml"
BACKEND_DIR="${SCRIPT_DIR}"
ASSETS_PATH="${BACKEND_DIR}/assets.json"
UPLOAD_SCRIPT="${BACKEND_DIR}/upload.js"
WRANGLER_CONFIG="${BACKEND_DIR}/wrangler.jsonc"

VERSION="${VERSION:-}"
BUILD_NUMBER="${BUILD_NUMBER:-}"

if [[ -z "${VERSION}" ]]; then
  FULL_VER="$(sed -nE 's/^version:[[:space:]]*([^[:space:]]+).*/\1/p' "${PUBSPEC}" | head -n1)"
  if [[ -z "${FULL_VER}" ]]; then
    echo "Failed to read version from ${PUBSPEC}"
    exit 1
  fi

  VERSION="${FULL_VER%%+*}"
  if [[ "${FULL_VER}" == *"+"* ]]; then
    BUILD_NUMBER="${FULL_VER#*+}"
  else
    BUILD_NUMBER="1"
  fi
fi

echo "======================================"
echo "Taiwan Brawl Auto Deployment"
echo "Version: ${VERSION} (Build #${BUILD_NUMBER})"
echo "Frontend: ${FRONTEND_DIR}"
echo "======================================"
echo

echo "[1/4] Building Flutter Frontend..."
cd "${FRONTEND_DIR}"
CMD="flutter build web --release --build-name=${VERSION} --build-number=${BUILD_NUMBER}"
echo "Running: ${CMD}"
flutter build web --release --build-name="${VERSION}" --build-number="${BUILD_NUMBER}"
echo "Step 1 completed"
echo

echo "[2/4] Generating asset list..."
cd "${BACKEND_DIR}"
if [[ -f "${UPLOAD_SCRIPT}" ]]; then
  node "${UPLOAD_SCRIPT}"
  echo "Step 2 completed"
else
  echo "upload.js not found, skipping asset generation"
fi
echo

echo "[3/4] Uploading static files to KV..."
if [[ -f "${ASSETS_PATH}" ]]; then
  DETECTED_KV_NAMESPACE_ID="$(node -e "const fs=require('node:fs');const p='${WRANGLER_CONFIG}';try{const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const ns=(cfg.kv_namespaces||[]).find(n=>n.binding==='STATIC_ASSETS');process.stdout.write(ns?.id||'');}catch{process.stdout.write('');}")"
  KV_TARGET_NAMESPACE_ID="${KV_NAMESPACE_ID:-${DETECTED_KV_NAMESPACE_ID}}"

  if [[ -z "${KV_TARGET_NAMESPACE_ID}" ]]; then
    echo "No KV namespace id found. Set KV_NAMESPACE_ID or configure STATIC_ASSETS in wrangler.jsonc"
    exit 1
  else
    echo "assetsPath: ${ASSETS_PATH}"
    echo "namespaceId: ${KV_TARGET_NAMESPACE_ID}"
    echo "Running: npm exec --package=wrangler@${WRANGLER_VERSION} -- wrangler kv bulk put ${ASSETS_PATH} --namespace-id ${KV_TARGET_NAMESPACE_ID} --remote"
    npm exec --package="wrangler@${WRANGLER_VERSION}" -- wrangler kv bulk put "${ASSETS_PATH}" --namespace-id "${KV_TARGET_NAMESPACE_ID}" --remote
    echo "Step 3 completed"
  fi
else
  echo "assets.json not found, skipping KV upload"
fi
echo

echo "[4/4] Deploying Workers..."
echo "Running: npm exec --package=wrangler@${WRANGLER_VERSION} -- wrangler deploy"
npm exec --package="wrangler@${WRANGLER_VERSION}" -- wrangler deploy
echo "Step 4 completed"
echo

echo "[4.5/4] Running smoke tests..."
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
echo "Deployment successful! Version: ${VERSION} (Build #${BUILD_NUMBER})"
echo "Access: https://taiwan-brawl-api.yunitrish0419.workers.dev"
echo "======================================"
echo

echo "Updating version number..."
NEXT_BUILD_NUMBER=$((BUILD_NUMBER + 1))
NEXT_VERSION="${VERSION}+${NEXT_BUILD_NUMBER}"

TMP_FILE="$(mktemp)"
awk -v new_version="${NEXT_VERSION}" '
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

echo "Next deployment version will be: ${NEXT_VERSION}"
echo
read -r -p "Press Enter to exit" _
