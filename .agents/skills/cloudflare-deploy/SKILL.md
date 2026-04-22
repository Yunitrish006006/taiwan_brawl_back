---
name: cloudflare-deploy
description: Build or update a Cloudflare Workers deploy toolkit with auto semver bump, Conventional Commit suggestion, and Flutter Web + Worker deployment flow.
---

# Cloudflare Deploy Skill

Use this skill when the user asks to set up or standardize deployment automation for a Cloudflare Workers backend with a sibling Flutter Web frontend.

Keywords: cloudflare, workers, wrangler, deploy.sh, semver, conventional commits, flutter web, d1 migrations, kv bulk put, commit suggestion.

## Goal

Create or maintain a deploy/version/commit toolkit composed of:

- `deploy.sh`
- `conventional_commit_rules.sh`
- `tool/suggest_commit_message.sh`
- `package.json` scripts for commit suggestion

The toolkit must support auto version bumping, pinned Wrangler execution, optional frontend build, and post-deploy smoke tests.

## Execution Contract (Auto-Generate Mode)

When this skill is selected, the agent must execute file generation/update work, not only provide guidance.

### Trigger Intent

Enter auto-generate mode when user intent includes one of the following:

- create or update deploy automation
- add or fix `deploy.sh`
- add Conventional Commit suggestion scripts
- standardize Cloudflare Workers + Flutter Web deployment pipeline

### Mandatory Actions

The agent must create or update all required artifacts in the target repo:

- `deploy.sh`
- `conventional_commit_rules.sh`
- `tool/suggest_commit_message.sh`
- `package.json` scripts (`commit:suggest`, `commit:suggest:front`)

The agent must preserve any intentional project conventions already listed in this skill (step numbering style, wrangler invocation style, version write-back pattern).

Before deploy actions, the agent must also implement:

- Cloudflare auth preflight via `wrangler whoami`
- automatic re-auth flow when token/session is expired by invoking `logout_and_login.sh`
- workspace preflight checks ensuring backend repo, frontend repo, and Flutter SDK environment are all present
- optional post-deploy auto commit for backend and frontend repositories
- optional post-deploy auto push for repositories committed in this run

### Mandatory Validation

After edits, the agent must run and verify:

```bash
bash -n deploy.sh
bash -n tool/suggest_commit_message.sh
npm run commit:suggest
npm run commit:suggest:front
```

If frontend repo is unavailable, skip only `commit:suggest:front` and report why.

If validation fails, the agent must attempt to fix and re-run validation before finishing.

### Completion Report Requirements

The final response must include:

1. Files created or updated
2. Validation command results
3. Any skipped step and reason
4. Remaining manual follow-up (if any)

## Required Artifacts

1. `conventional_commit_rules.sh`
- Central source of Conventional Commit and path-based rules.
- Must define:
	- `CC_MINOR_TYPES`, `CC_PATCH_TYPES`, `CC_NONE_TYPES`
	- `CC_VERSION_IGNORED_PATHS`, `CC_VERSION_MINOR_PATHS`, `CC_VERSION_PATCH_PATHS`
	- `CC_SCOPE_RULES` with format: `glob|scope|type|中文摘要`
- Rule order is significant. More specific rules go earlier.
- Adapt path rules to the real module structure of the current project.

2. `deploy.sh`
- End-to-end deploy script.
- At script start, if `NODE_TLS_REJECT_UNAUTHORIZED="0"`, unset it.
- Run preflight checks before deploy steps:
	- backend presence check (`package.json`, `wrangler.jsonc`)
	- frontend presence check (`pubspec.yaml`)
	- flutter environment check (`flutter` + `dart` executable)
	- Cloudflare auth check (`wrangler whoami`)
	- if auth expired, run `logout_and_login.sh`, then retry auth once
- Support env overrides:
	- `VERSION`
	- `VERSION_BUMP=auto|major|minor|patch|none`
	- `WRANGLER_VERSION`
	- `AUTO_COMMIT=0|1` (default `0`)
	- `AUTO_COMMIT_BACKEND_MESSAGE`
	- `AUTO_COMMIT_FRONTEND_MESSAGE`
	- `AUTO_PUSH=0|1` (default `0`, requires `AUTO_COMMIT=1`)
	- `EXIT_PROMPT=0|1`
	- `FRONTEND_DIR`
	- `FLUTTER_BIN_DIR`
	- `D1_DATABASE_NAME`
	- `KV_NAMESPACE_ID`
	- `DEPLOY_BASE_URL`

3. `tool/suggest_commit_message.sh`
- Suggest Conventional Commit message from changed files.
- Required CLI:
	- `--repo <path>`
	- `--summary <text>`
	- `--explain`
	- `-h|--help` (Chinese usage text)
- Output must be exactly: `type(scope): 中文摘要`

4. `package.json` scripts
- Ensure:
	- `commit:suggest`
	- `commit:suggest:front`

## Versioning Rules

`VERSION_BUMP=auto` must compute highest bump level from four sources:

1. Backend git commits since anchor
2. Frontend git commits since anchor
3. Backend current working tree changes
4. Frontend current working tree changes

Anchor: epoch timestamp of the latest commit touching `pubspec.yaml`.

Conventional Commit bump mapping:

- `major`: `!` in type scope marker or body contains `BREAKING CHANGE:` / `BREAKING-CHANGE:`
- `minor`: `feat`
- `patch`: `fix`, `perf`, `refactor`
- `none`: `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`, unknown types

Path bump mapping:

- minor-path match => `minor`
- patch-path match => `patch`
- added/deleted non-ignored file => `minor`
- ignored path => skip

## Deploy Flow (Must Preserve Order)

The deploy log style intentionally uses fractional step numbers.

1. `[0/6]` Run preflight checks (workspace + Flutter + Cloudflare auth, with auto re-login if token expired).
2. `[1/5]` Generate locale catalog if `tool/generate_locale_catalog.dart` exists.
3. `[2/5]` Run Flutter web release build with `--build-name=<version>`.
4. `[3/5]` Run `node upload.js` if present.
5. `[3.5/6]` Ensure backend dependencies (`npm ci`, fallback `npm install` when needed).
6. `[4/6]` Apply D1 migrations remotely if `migrations/` exists.
7. `[5/6]` Upload assets via KV bulk put if `assets.json` exists.
8. `[6/6]` Run Worker deploy.
9. `[6.5/6]` Smoke tests:
	 - `GET /` => HTTP 200
	 - `GET /login` => HTTP 200
	 - `GET /api/health` response contains `"ok":true`
10. `[7/6]` Optional auto commit:
	 - only when `AUTO_COMMIT=1`
	 - commit backend and frontend repos independently when changes exist
	 - use `AUTO_COMMIT_BACKEND_MESSAGE` and `AUTO_COMMIT_FRONTEND_MESSAGE` when provided
11. `[7.5/6]` Optional auto push:
	 - only when `AUTO_PUSH=1`
	 - requires `AUTO_COMMIT=1`
	 - push only repos that were auto committed in this deploy run

After success, write semver back into the first `version:` key in `pubspec.yaml` using `awk` + temp file + `mv`.

## Wrangler Execution Requirement

Always invoke Wrangler via:

`npm exec --package=wrangler@<version> -- <wrangler args>`

Do not call a globally installed Wrangler directly.

## Discovery Rules

Frontend directory detection order:

1. `FRONTEND_DIR`
2. `../<backend_repo_name_with_front_suffix>`
3. `../front`

Flutter bin directory detection order:

1. `FLUTTER_BIN_DIR`
2. `dirname $(command -v flutter)`
3. `/Volumes/DataExtended/flutter/bin`
4. `~/flutter/bin`
5. `~/development/flutter/bin`

`D1_DATABASE_NAME`, `KV_NAMESPACE_ID`, and default deploy base URL should be read at runtime from `wrangler.jsonc` via inline `node -e` parsing logic.

## Reuse Constraints

When adapting from template, keep these helper functions logically unchanged:

- `version_bump_rank`
- `max_version_bump`
- `bump_semver`
- `path_matches_patterns`
- `array_contains`

## Validation Checklist

Run all commands and require exit code 0:

```bash
bash -n deploy.sh
bash -n tool/suggest_commit_message.sh
npm run commit:suggest
npm run commit:suggest:front
```

If frontend repo is absent, skip only `commit:suggest:front` with a clear reason.

## Example Trigger Prompts

- "幫我在 Cloudflare Workers 專案加上 deploy.sh 自動版號"
- "建立 Conventional Commit 建議腳本"
- "把 Flutter Web + Workers 的部署流程標準化"
- "補齊 D1 migration + KV assets + smoke test 的部署管線"