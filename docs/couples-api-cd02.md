# CD-02 couples API

Status: local implementation and runtime tests complete. Production enablement,
friendship reader/writer binding cutover and account lifecycle delivery remain
pending CD-03. Frontend integration and home widgets remain CD-04 onwards.

Update: CD-03 integration is now locally implemented; see
[social/lifecycle results](social-lifecycle-cd03.md). Production cutover is still
pending. Couples now additionally requires DATABASE_MODE=split.

## Implementation

`src/api/couples_api.js` owns typed routing, same-origin cookie checks, Bearer
session authentication against the main DB, account lifecycle checks, date/time
zone validation, body validation and rate-limit responses. The integrated API
router dispatches only the couples namespace to this handler; existing friend
response formats and existing routes remain unchanged.

`src/features/couples_repository.js` owns participant scoping, overview,
parameterized transactional state changes and durable response envelopes.
CD-01 accept primitives are reused within the same SOCIAL_DB batch. Every
state-dependent guard, mutation, audit and operation result commits together.
An UPDATE affecting no rows is not assumed to fail automatically.

Implemented routes:

- GET /api/couples/overview
- POST /api/couples/requests
- POST /api/couples/requests/:id/accept, reject, cancel
- POST /api/couples/:id/date-proposals
- POST /api/couples/date-proposals/:id/accept, reject, cancel
- POST /api/couples/:id/end

Request/response fields follow the coordination repository's
[CD-00 contract](../../TaiwanBrawlWorkspace/docs/couple-days-cd00-contract.md).
Dates use a Gregorian date string, validated against server time converted to
the supplied timezone. No server-wide dayCount is persisted or returned.
Pending requests/proposals expire at seven elapsed days; rejecting an invitation
does not impose a 24-hour cooldown. Expired pair/proposal reservations are
released within the next corresponding create transaction.

Successful operation envelopes are stored atomically under actor + operationId.
Replays reauthenticate, reauthorize participants, verify the body/path hash and
return the saved envelope with replayed:true. Same ID with different content is
409. In-flight duplicate batches roll back their extra effects and recover the
first committed result. Replayed old snapshots are not current relationship
authority: clients must refresh overview after a mutation/replay.

Ending a relationship does not require the latest date version. Either member
can end it; dates pending at that moment become invalidated. A member can also
end a relationship whose partner is already inactive, while inactive or
tombstoned actors cannot mutate. Repeating the same end operation is replayed;
a new operation against an already ended relationship is a 409.

Cookie POST requires JSON and an Origin exactly matching the Worker request
origin. Web v1 uses the integrated same-origin frontend; arbitrary localhost or
external origins are not allowed. Native Bearer requests may omit Origin;
provided Origin must still match. CORS headers alone do not authorize writes.
Bodies are limited to 16 KiB while streaming. All responses are private/no-store;
errors expose stable codes and matching body/header request IDs, not SQL errors.
General API KV limits are reused with typed 429 and Retry-After; their existing
KV-failure behavior remains best effort, not a hard distributed abuse quota.

## Enablement gate

The route requires ENABLE_COUPLES_API exactly equal to the string true and both
DB and SOCIAL_DB bindings. The production config is not changed and does not
enable the feature. Do not enable it before verifying migrations, authoritative
social data cutover and CD-03 block/remove/lifecycle consumers. DB and SOCIAL_DB
failures return a sanitized 503. Separate DB checks cannot guarantee globally
atomic account revocation; CD-03's outbox/tombstone cleanup remains necessary.

## Validation

`npm test` passes 206 existing Node tests, 1 SignalRoom workerd test and 32 D1
tests (12 schema/batch tests plus 20 API tests). The API suite runs in actual
workerd D1 and enters through the integrated API router. It consumes the shared
CD-00 create fixture and covers full invite/date/end flow, privacy, cookie Origin,
invalid JSON/size/fields, timezone upper bounds, expired sessions, inactive
accounts, replays and hash collisions, reverse invites, no rejection cooldown,
seven-day boundary, concurrent duplicate accepts, accept/block and date/end
races, typed rate limits and dependency failures.

The backend stores its test fixture at database-tests/fixtures/couple-days-v1.json
so backend tests run without a sibling coordination checkout. The workspace
couples-contract test verifies this copy equals the canonical fixture.

`npm run db:split:rehearse` and `npm run db:migration:rehearse` pass. Frontend
regression: flutter analyze reports no issues; flutter test passes 324 tests
with 3 skipped. Those frontend tests cover existing consumers, not the pending
couples consumer or native widgets. Flutter reports existing Swift Package
Manager adoption warnings for plugins; no native build or real-device result
is claimed.

## 後續：桌面元件伴侶名稱

依使用者後續要求，overview 的 active relationship 新增可選 `partnerName`。
來源為主庫目前伴侶的 `users.name`，仍受相同身分、生命週期、好友與封鎖檢查；
移除控制字元並限制 80 Unicode code points。mutation／冪等回應不固定個人名稱，
前端成功後照原流程重新抓 overview。舊回應沒有此欄時仍相容，沒有新增資料表
或 migration。新 D1 測試涵蓋名稱變更及第三方不得取得關係；正式開關未變更。
