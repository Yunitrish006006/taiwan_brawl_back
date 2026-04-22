#!/usr/bin/env bash
set -euo pipefail

# 登出 Cloudflare Workers 並重新登入
WRANGLER_PACKAGE="${WRANGLER_PACKAGE:-wrangler@latest}"

echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler logout"
npm exec --package="${WRANGLER_PACKAGE}" -- wrangler logout

echo "Running: npm exec --package=${WRANGLER_PACKAGE} -- wrangler login"
npm exec --package="${WRANGLER_PACKAGE}" -- wrangler login
