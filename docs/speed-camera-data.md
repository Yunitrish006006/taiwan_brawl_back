# Police speed-camera data (NPA dataset 7320)

Source: https://data.gov.tw/dataset/7320 (Government Open Data License, version 1.0).
The official CSV exposes `CityName,RegionName,Address,DeptNm,BranchNm,Longitude,Latitude,direct,limit`.

## Automated staging (implemented)
- The `Stage official speed camera dataset` GitHub Action downloads the exact government resource, validates the schema and basic coordinate/data-quality checks, and uploads a versioned JSON **artifact**.
- A bad download never overwrites the previous good output: the build rejects missing columns, fewer than 500 valid points or more than 10% rejected rows.
- The resulting `contentSha256` hashes the normalized points, not the refresh time.
- This stage **does not publish or deploy** to production.

Local run (requires Node 22 or later):

```bash
node scripts/fetch_speed_camera_dataset.mjs dist/speed-camera/npa7320.json
node --test tests/speed_camera_core.test.js tests/speed_camera_csv.test.js tests/speed_camera_api.test.js tests/speed_camera_ingestion.test.js
npm test
```

## API contract (implemented in feature branch)
- `GET /api/speed-cameras/manifest`: source attribution, schema version, generation time, number of points, content version.
- `GET /api/speed-cameras/snapshot`: full normalized point dataset, suitable for offline download.
- Both return HTTP 503 if the **separate** `SPEED_CAMERA_DATA` KV binding is absent, empty, or malformed. They do not expose false empty results.

## Production configuration (not completed)
1. Provision a **new isolated Cloudflare KV namespace** for `SPEED_CAMERA_DATA` in a nonproduction environment.
2. Add its real KV namespace ID to the Worker `wrangler.jsonc` under `kv_namespaces`. Do not reuse `CHAT_SYNC`, `PUSH_RETRY` or `STATIC_ASSETS`.
3. Review and publish the validated JSON under key `npa7320:snapshot` (for example using Wrangler's KV key put command in an authorized environment).
4. Verify the manifest and snapshot endpoints using the staging Worker; inspect attribution and count, then verify the app's offline refresh/fallback.
5. Add a *separate* least-privilege release workflow to publish validated data on a schedule. Do not enable unattended production writes until validation and rollback are proven.

## Driving safety
Government rows may include average-speed zone references and various enforcement types. The current source does **not** consistently identify fixed versus mobile equipment or validate a road segment. Raw `direct` values are retained, never treated as numerical driving bearings. GPS proximity and heading matching only produce *candidates*.

An actual navigation-grade reminder requires road matching, opposite carriageway handling, elevated/ground road differentiation, user-controlled tracking, GPS drift tests, and native device testing. Do not imply this first version is a navigation-grade enforcement feed.
