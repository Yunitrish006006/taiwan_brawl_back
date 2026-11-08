# CD-03 social integration and account lifecycle

Status: implemented and verified locally. Production data, bindings and schedules
have not been changed. Frontend couples UI and home widgets remain pending.

## Database selection

DATABASE_MODE=split selects SOCIAL_DB for friends, chat messages/pending/ack,
chat devices, signaling friendship checks and ChatRoom history. It selects
GAME_DB for Mini Royale cards, decks, progression and match history. Account,
session, profile, LLM credentials and push registrations stay in DB. Missing
split bindings raise errors rather than falling back to stale main tables.
Unset DATABASE_MODE preserves the pre-cutover legacy DB behavior.

Friends overview combines social rows with explicitly selected public profiles
from DB in batches of 50. It preserves friend/request/invite response shapes and
never copies the account table to SOCIAL_DB. Search excludes inactive accounts.
The existing friend acceptance and game-room invitation mutations use same-batch
eligibility guards in split mode; concurrent block cannot recreate a friendship.

Block/remove calls from the existing friend routes now atomically update the
friendship, end the couple, free both member slots, invalidate couple requests
and date proposals, and cancel pending social invitations. Repeated operations
do not increment the ended relationship again. The user-facing confirmation
before these operations will be implemented with the frontend in CD-05.

ENABLE_COUPLES_API=true additionally requires DATABASE_MODE=split. This avoids
enabling couples in SOCIAL_DB while friends still use the old main DB. The
production wrangler.jsonc was not modified in this slice. The isolated
wrangler.split.local.jsonc sets split mode but leaves couples disabled and
declares a one-minute cron for local configuration review.

## Lifecycle transition and delivery

POST /api/admin/users/:id/lifecycle accepts {status,operationId}, where status is
disabled or deleting. It requires an authenticated administrator, JSON and a
same-origin cookie request or native Bearer request; an administrator cannot
terminate their own administrator account. This is a backend capability, not a
new account-management UI. There is no account reactivation endpoint.

terminateAccount atomically changes account status/epoch, revokes sessions and
records a durable outbox event plus one delivery row per target. Migration 0032
adds uniqueness for account+epoch and a transaction guard. Session creation in
split mode only inserts when the account remains active; Google login and common
session restoration also reject terminated accounts.

Worker scheduled uses waitUntil to scan due deliveries. Each target transaction
upserts a monotonic account tombstone, ends/invalidates social relationships or
cleans player-owned game data, and writes an event receipt. Target commit must
precede producer acknowledgement. Retries after 1/2/4/8/16/32/60 minutes remain
durable without a discard limit; each target succeeds independently. Events
overdue by five minutes produce a structured warning count. Duplicate deliveries
and a lost acknowledgement do not duplicate audit or restore state.

The main account row remains disabled/deleting, and audit/operation history is
retained. This is access revocation and dependent-state cleanup, not completed
physical PII erasure or a new privacy-retention policy. Cloud/local account
deletion UX and any later physical purge require their own implementation.

Social migration 0004 and game migration 0003 add real D1 triggers rejecting
late inserts/updates that refer to tombstoned accounts. Terminal invalidation
and cleanup operations remain allowed. Even connected ChatRoom/SignalRoom
consumers recheck main account and current friendship authority before carrying
new messages. Game background match/progression writers check active accounts
and use the game binding. Main-DB failure denies these operations.

Account revocation across databases remains eventually consistent: a request
already in flight can commit before the target receives its tombstone, then the
durable delivery cleans it. No global cross-database lock is claimed. Offline
home widgets will follow the chosen last-known-state counting behavior.

## Local evidence

The workerd D1 suite contains 54 passing tests: 12 original database gates,
20 couples API tests, and 22 integration/lifecycle tests. New tests exercise real
friend and admin routes, transactional failure injection, no cross-DB JOIN,
session revocation and recreation denial, independent retries, monotonic epochs,
tombstone write rejection, lost acknowledgements, accept/block races, preserved
consumer payloads, actual SignalRoom WebSockets after runtime eviction, and
overdue detection even while a failed event is waiting for its next retry.

Existing backend suites passed 206 Node tests and 1 SignalRoom runtime test;
both migration rehearsals passed. Frontend analyzer and VM tests pass; the required
Chrome WebRTC/identity/trust consumer gate passes 31 tests with 3 VM-only skips.
These are local results, not signed mobile builds or live deployment evidence.

## Rollout and next work

Before production cutover: apply/rehearse main and per-target migrations, migrate
and verify source rows/cursors/sequence high water, pause all foreground and
background writers for final reconciliation, configure all three bindings and
the cron, switch DATABASE_MODE atomically with the deploy, then smoke test.
Only after those checks may the operator enable couples. Do not roll back to
legacy mode with stale rows or bypass lifecycle authorization; reconcile writes
and preserve revoked account state before any rollback.

CD-04 is the typed frontend remote source, service and account-isolated cache.
