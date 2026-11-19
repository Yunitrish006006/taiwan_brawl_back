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

## KV publication and recovery

The Cron publisher validates UTF-8, bounds download size, rejects schema changes
and high rejection/duplicate rates, and blocks a drop of more than 20% from the
last verified snapshot. A refresh with the same verified content skips the write.
One KV value (`npa7320:catalog:v1`) carries the current and previous content
versions. Readers validate schema and content hash and fall back to the previous
snapshot when current content fails validation. The original
`npa7320:snapshot` key remains a migration fallback. Download and validation
failures occur before the KV write.

A client can request `/api/speed-cameras/snapshot?version=<manifest-version>`.
A node that has yet to observe that publication can return 404. Keep the local
verified snapshot and retry on the next refresh. KV replication is eventually
consistent. Configure a single writer and avoid overlapping manual and scheduled
writes. See [Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Nonproduction rollout

1. Copy `wrangler.speed-camera-staging.example.jsonc` alongside the example,
   insert the dedicated staging KV ID and deploy only with the staging config.
   The isolated Worker serves the same read-only API and runs the same Cron
   publisher. It has no bindings for the Taiwan Brawl application.
2. Trigger the staging Cron and compare the manifest count and SHA-256 with the
   official staging artifact. Fetch the version-qualified snapshot and repeat
   through the client.
3. Inject a failed refresh and verify the manifest still advertises the last good
   version. Verify that a version-qualified download works during a normal
   change. For an operator-directed rollback, stop the writer before restoring
   the last verified catalog, then verify across locations before resuming it.
4. Record the staging Worker run and review before configuring production.

Production Worker configuration has no speed-camera binding or trigger on this
branch.

## Driving safety
Government rows may include average-speed zone references and various enforcement types. The current source does **not** consistently identify fixed versus mobile equipment or validate a road segment. Raw `direct` values are retained, never treated as numerical driving bearings. GPS proximity and heading matching only produce *candidates*.

An actual navigation-grade reminder requires road matching, opposite carriageway handling, elevated/ground road differentiation, user-controlled tracking, GPS drift tests, and native device testing. Do not imply this first version is a navigation-grade enforcement feed.
