#!/usr/bin/env bash
# tool/build_android.sh — 建置 Google Play 用的 Android App Bundle (.aab)
#
# 選用環境變數：
#   VERSION          強制指定版本號（跳過自動計算）
#   FLUTTER_BIN_DIR  Flutter SDK bin/ 路徑
#   FRONTEND_DIR     Flutter 前端 repo 路徑
#
# 範例：
#   bash tool/build_android.sh
#   VERSION=1.0.0 bash tool/build_android.sh

set -euo pipefail

if [[ "${NODE_TLS_REJECT_UNAUTHORIZED:-}" == "0" ]]; then
  unset NODE_TLS_REJECT_UNAUTHORIZED
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── 解析前端目錄 ────────────────────────────────────────────────────────────

resolve_frontend_dir() {
  if [[ -n "${FRONTEND_DIR:-}" && -f "${FRONTEND_DIR}/pubspec.yaml" ]]; then
    printf '%s\n' "${FRONTEND_DIR}"
    return 0
  fi

  local candidates=(
    "${BACKEND_DIR}/../taiwan_brawl_front"
    "${BACKEND_DIR}/../front"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}/pubspec.yaml" ]]; then
      printf '%s\n' "$(cd "${candidate}" && pwd)"
      return 0
    fi
  done

  echo "找不到 Flutter 前端目錄。請設定 FRONTEND_DIR 或將前端放在 ../taiwan_brawl_front" >&2
  exit 1
}

# ── 解析 Flutter SDK ──────────────────────────────────────────────────────

resolve_flutter_bin_dir() {
  if [[ -n "${FLUTTER_BIN_DIR:-}" && -x "${FLUTTER_BIN_DIR}/flutter" ]]; then
    printf '%s\n' "${FLUTTER_BIN_DIR}"
    return 0
  fi

  local resolved_flutter
  resolved_flutter="$(command -v flutter 2>/dev/null || true)"

  local candidates=(
    "/Volumes/DataExtended/flutter/bin"
    "${HOME}/flutter/bin"
    "${HOME}/development/flutter/bin"
  )

  if [[ -n "${resolved_flutter}" ]]; then
    candidates=("$(dirname "${resolved_flutter}")" "${candidates[@]}")
  fi

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "${candidate}" && -x "${candidate}/flutter" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  echo "找不到 Flutter SDK。請設定 FLUTTER_BIN_DIR 或安裝 Flutter" >&2
  exit 1
}

FRONTEND_DIR="$(resolve_frontend_dir)"
FLUTTER_BIN_DIR="$(resolve_flutter_bin_dir)"
export PATH="${FLUTTER_BIN_DIR}:${PATH}"
PUBSPEC="${FRONTEND_DIR}/pubspec.yaml"

# ── 讀取版本 ───────────────────────────────────────────────────────────────

CURRENT_VERSION="$(sed -nE 's/^version:[[:space:]]*([^[:space:]+]+).*/\1/p' "${PUBSPEC}" | head -n1)"
CURRENT_VERSION="${CURRENT_VERSION%%+*}"

if [[ -z "${CURRENT_VERSION}" ]]; then
  echo "無法從 ${PUBSPEC} 讀取版本號" >&2
  exit 1
fi

BUILD_VERSION="${VERSION:-${CURRENT_VERSION}}"

echo "======================================"
echo "Android App Bundle 建置"
echo "版本：${BUILD_VERSION}"
echo "前端路徑：${FRONTEND_DIR}"
echo "Flutter SDK：${FLUTTER_BIN_DIR}"
echo "======================================"
echo

# ── [1/3] 產生語系目錄 ─────────────────────────────────────────────────────

LOCALE_GENERATOR="${FRONTEND_DIR}/tool/generate_locale_catalog.dart"
echo "[1/3] 產生語系目錄..."
cd "${FRONTEND_DIR}"
if [[ -f "${LOCALE_GENERATOR}" ]]; then
  dart run tool/generate_locale_catalog.dart
  echo "語系目錄完成"
else
  echo "找不到 generate_locale_catalog.dart，跳過"
fi
echo

# ── [2/3] 建置 App Bundle ─────────────────────────────────────────────────

echo "[2/3] 建置 Flutter App Bundle..."
flutter build appbundle --release --build-name="${BUILD_VERSION}"
echo "建置完成"
echo

# ── [3/3] 確認輸出路徑 ────────────────────────────────────────────────────

AAB_PATH="${FRONTEND_DIR}/build/app/outputs/bundle/release/app-release.aab"
echo "[3/3] 輸出確認..."
if [[ -f "${AAB_PATH}" ]]; then
  AAB_SIZE="$(du -sh "${AAB_PATH}" | cut -f1)"
  echo "✓ ${AAB_PATH}"
  echo "  大小：${AAB_SIZE}"
else
  echo "找不到 .aab 輸出檔案，建置可能失敗" >&2
  exit 1
fi
echo

echo "======================================"
echo "建置成功！版本：${BUILD_VERSION}"
echo "上傳以下檔案至 Google Play Console："
echo "  ${AAB_PATH}"
echo "======================================"
