#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RULES_FILE="${BACKEND_DIR}/conventional_commit_rules.sh"

CC_MINOR_TYPES=(feat)
CC_PATCH_TYPES=(fix perf refactor)
CC_NONE_TYPES=(docs test build ci chore style revert)
CC_SCOPE_RULES=("*|app|chore|更新專案檔案")

if [[ -f "${RULES_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${RULES_FILE}"
fi

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

path_rule_match() {
  local path="$1"
  local index=0
  local rule pattern scope type summary
  for rule in "${CC_SCOPE_RULES[@]}"; do
    IFS='|' read -r pattern scope type summary <<< "${rule}"
    case "${path}" in
      ${pattern})
        printf '%s|%s|%s|%s\n' "${index}" "${scope}" "${type}" "${summary}"
        return 0
        ;;
    esac
    index=$((index + 1))
  done

  printf '999|app|chore|更新專案檔案\n'
}

type_to_bump() {
  local type="$1"
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

version_bump_rank() {
  case "$1" in
    none) echo 0 ;;
    patch) echo 1 ;;
    minor) echo 2 ;;
    major) echo 3 ;;
    *) echo 0 ;;
  esac
}

normalize_subject() {
  local text="$1"
  printf '%s' "${text}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

usage() {
  cat <<'EOF'
用法：
  bash tool/suggest_commit_message.sh [--repo PATH] [--summary "custom summary"] [--explain]

範例：
  bash tool/suggest_commit_message.sh
  bash tool/suggest_commit_message.sh --summary "重整 royale room runtime helpers"
  bash tool/suggest_commit_message.sh --repo ../taiwan_brawl_front
EOF
}

REPO_DIR="${PWD}"
CUSTOM_SUMMARY=""
EXPLAIN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_DIR="$2"
      shift 2
      ;;
    --summary)
      CUSTOM_SUMMARY="$2"
      shift 2
      ;;
    --explain)
      EXPLAIN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知參數：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

GIT_ROOT="$(git -C "${REPO_DIR}" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${GIT_ROOT}" ]]; then
  echo "不是 git repository：${REPO_DIR}" >&2
  exit 1
fi

STATUS_LINES=()
while IFS= read -r line; do
  STATUS_LINES+=("${line}")
done < <(git -C "${GIT_ROOT}" status --short --untracked-files=all)

if (( ${#STATUS_LINES[@]} == 0 )); then
  echo "在 ${GIT_ROOT} 沒有偵測到變更" >&2
  exit 1
fi

BEST_TYPE="chore"
BEST_SCOPE="app"
BEST_SUMMARY="更新專案檔案"
BEST_BUMP="none"
BEST_PATH=""
BEST_RULE_INDEX=999

for line in "${STATUS_LINES[@]}"; do
  [[ -z "${line}" ]] && continue
  path="${line:3}"
  trimmed_path="${path##* -> }"

  IFS='|' read -r rule_index scope type summary <<< "$(path_rule_match "${trimmed_path}")"
  bump="$(type_to_bump "${type}")"

  if (( $(version_bump_rank "${bump}") > $(version_bump_rank "${BEST_BUMP}") )); then
    BEST_TYPE="${type}"
    BEST_SCOPE="${scope}"
    BEST_SUMMARY="${summary}"
    BEST_BUMP="${bump}"
    BEST_PATH="${trimmed_path}"
    BEST_RULE_INDEX="${rule_index}"
    continue
  fi

  if (( $(version_bump_rank "${bump}") == $(version_bump_rank "${BEST_BUMP}") )) && (( rule_index < BEST_RULE_INDEX )); then
    BEST_TYPE="${type}"
    BEST_SCOPE="${scope}"
    BEST_SUMMARY="${summary}"
    BEST_PATH="${trimmed_path}"
    BEST_RULE_INDEX="${rule_index}"
  fi
done

if [[ -n "${CUSTOM_SUMMARY}" ]]; then
  SUBJECT="$(normalize_subject "${CUSTOM_SUMMARY}")"
else
  SUBJECT="${BEST_SUMMARY}"
fi

COMMIT_MESSAGE="${BEST_TYPE}(${BEST_SCOPE}): ${SUBJECT}"

if (( EXPLAIN )); then
  echo "repo: ${GIT_ROOT}"
  echo "scope: ${BEST_SCOPE}"
  echo "type: ${BEST_TYPE}"
  echo "bump: ${BEST_BUMP}"
  echo "matched-path: ${BEST_PATH}"
fi

echo "${COMMIT_MESSAGE}"
