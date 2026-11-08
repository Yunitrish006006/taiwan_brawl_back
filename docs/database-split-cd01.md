# CD-01 local database foundation

Status: local schema, rehearsal and D1 batch gates complete. Production still uses
the existing DB binding. These changes do not create a remote database, migrate
production rows or enable the couples HTTP API.

## Files and usage

- Main additive migration: migrations/0031_account_lifecycle.sql. Existing users
  default to active/epoch 1; outbox deliveries are tracked per target database.
- Social: migrations/social/0001_baseline.sql (8 existing social tables),
  0002_couples.sql (relationships, membership, requests, proposals, audit,
  operation ledger, write guards), 0003_account_lifecycle.sql.
- Games: migrations/games/0001_baseline.sql (7 existing game tables),
  0002_account_lifecycle.sql. Account IDs become logical references; local
  deck/card and pending/ack foreign keys remain enforced.
- src/features/couple_transactions.js provides parameterized batch builders for
  accepting a couple request and atomically removing/blocking a friend and ending
  the relationship. Callers in CD-02/03 must supply account authorization,
  date validation, idempotency lookup and complete API response serialization.
  The internal ledger result stores the relationship ID, not a public envelope.
- wrangler.split.local.jsonc has isolated local IDs and separate migration
  directories. Do not deploy it or pass --remote. The normal wrangler.jsonc
  remains unchanged by CD-01. Normal deployment still needs a reviewed cutover.

Commands from backend root:

```sh
npm run db:split:rehearse
npm run db:migration:rehearse
npm run test:database
npm test
```

The split rehearsal builds the full source schema in SQLite memory, inserts
nonempty fixtures in all 15 moved tables, attaches isolated target databases,
copies rows, and compares contents in both directions. It checks retained users
and session, pending cursor/ack metadata and AUTOINCREMENT high water 999. It
does not perform a live import. Frozen baseline drift is rejected by comparison
against the schema derived from original migrations 0001–0030 with FK enabled.
Source tables are retained; no source table is dropped.

The separate Vitest configuration starts actual workerd D1 bindings without
production credentials. Twelve tests cover isolation, internal FK enforcement,
account defaults and per-target deliveries, accept, second-member collision
rollback, zero-row guard failure, reused operation rollback, competing accepts,
accept vs block/remove, expiry/tombstone rejection and pending-pair/proposal
constraints. npm test includes this suite so it cannot be silently omitted.

## Results and remaining work

Local SQLite rehearsal: all 8 social + 7 game tables preserved with 0 FK
violations; source users/session retained. Existing namespace migration rehearsal
also passes. D1 suite: 12 passed. Existing backend tests: 206 Node tests and
1 SignalRoom runtime test passed.

Pending CD-02/03: routes, date-proposal mutations, authentication/origin checks,
idempotent replay of public envelopes, account-lifecycle delivery worker and
all existing reader/writer binding switches. Production cutover requires the
separate approved migration procedure including background-writer pause,
row verification and rollback reconciliation. No frontend contract has changed
at runtime in this slice.
