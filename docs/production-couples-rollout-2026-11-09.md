# Production couples rollout — 2026-11-09

The user authorized making online invitations and binding usable on the existing
production website. Initial production returned 404 for couple overview.

## Prepared and verified

- Production main D1 was exported to private local storage. No account rows,
  sessions, messages, credentials or database exports belong in Git.
- The private snapshot contains 10 accounts and 10 sessions. All existing rows
  survived the nine pending main migrations in a local SQLite rehearsal, with
  zero foreign-key violations. Legacy Web Push registrations remain archived by
  migration 0028; that migration does not convert Web Push credentials to FCM.
- The new `taiwan_brawl_social_db` and `taiwan_brawl_game_db` databases exist.
  Their isolated migrations (social 0001–0005, games 0001–0003) were applied.
  They have not yet received production application rows or traffic.
- Production encrypted chat has a `nonce` column absent from the frozen baseline.
  Social migration 0005 preserves it. Preparation refuses unknown source-column
  drift rather than silently dropping metadata.
- Backend tests: 213 Node tests, one SignalRoom runtime test, 56 actual workerd
  D1 tests, both existing migration rehearsals and the Worker dry-run passed.
  Preparation tests also prove preserved deleted-message cursor high water,
  retained-account release, old-source write blocking, binary data integrity and
  rejection of an altered target export.

At preparation time the main production database and live Worker are unchanged.
The checked-in configuration describes the intended target. Do not run the
integrated deployment script before completing the cutover procedure below.

## Cutover order

1. Recheck the current Worker and bindings, preserve secrets with `--keep-vars`,
   then deploy the tested maintenance gate with `MAINTENANCE_MODE=true`,
   `DATABASE_MODE=legacy`, `ENABLE_COUPLES_API=false` and immediate Durable
   Object code adoption. Health and static assets remain available; API writes,
   scheduled work, room ticks and socket mutations pause.
2. Install source write guards, including retained account/session tables. This
   also rejects late writers on older Worker instances. Export a fresh frozen
   source snapshot. Rehearse it again with `prepare-split-cutover.py`; do not
   copy from the earlier preparation snapshot.
3. Apply the verified pending main migrations under maintenance. Export again
   and prepare private social/game INSERT files, including exact original IDs,
   timestamps, payloads and AUTOINCREMENT high water. Existing source domain
   tables stay intact after their reviewed namespace renames.
4. Confirm both targets are empty, import their prepared data, export both actual
   remote targets and run `verify-split-cutover.py`. All 15 tables must match
   their source row hashes/counts, sequences and foreign-key checks.
5. Release only retained-main write guards. Keep old social/game source tables
   read-only. Deploy the final split configuration, all three bindings, the
   lifecycle cron and enabled couples API, with immediate DO code adoption.
6. Verify public health and unauthenticated typed 401. Exercise real production
   friend/invite/accept/date/end routes using isolated temporary verification
   accounts; remove only those explicitly tracked probe rows afterward. Verify
   existing account/session counts and unchanged frontend release bytes.

Never restore an old backup over new production writes or roll back to stale
legacy domain tables. After split writes begin, rollback requires reconciliation
and preservation of account revocations. Before cutover, the old deployment ID
and private backup remain available as evidence and recovery inputs.

## Tooling

`scripts/prepare-split-cutover.py --source-sql <private-export.sql> --output-dir
<new-private-directory>` only prepares and validates local artifacts. It never
contacts Cloudflare, overwrites an existing output directory or prints row data.

`scripts/verify-split-cutover.py --plan-dir <private-directory> --social-sql
<remote-social-export.sql> --games-sql <remote-games-export.sql>` verifies actual
remote export bytes against the prepared source, without reporting private rows.

Cloudflare's [DO update documentation](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/)
explains why a code deployment alone may leave older DO writers active; this
cutover uses the supported immediate override plus database write guards.
Database backups/imports follow [Cloudflare D1's documented SQL export/import flow](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## iPhone testing requested during preparation

The user requested App and home-widget testing on a connected iPhone 11 running
iOS 27.0.1. Xcode 27.2 was installed from the Mac App Store, its license was
confirmed by the user and the device is paired. Development signing, Developer
Mode and physical App Group/widget acceptance are still pending. These are
separate from the successful unsigned/simulator CI builds and local Foundation
checks. Do not report physical iPhone acceptance from those results.
