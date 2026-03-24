#!/bin/bash
# 登出 Cloudflare Workers 並重新登入

# 登出
npm exec wrangler logout

# 登入
npm exec wrangler login
