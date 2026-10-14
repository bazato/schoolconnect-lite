# Render to Neon migration — 2026-10-14

Source: Render `schoolconnect-demo-postgres` (`dpg-db18u4jncjis73bnljh0-a`), PostgreSQL 17.11, Frankfurt.
Destination: Neon project `Nexqon` (`empty-silence-25013431`), organization `org-fragrant-wave-17164401`, production branch `br-dry-bird-b9go12pj`, PostgreSQL 17.11, Frankfurt.
Application: Render `schoolconnect-demo-api` (`srv-db18uebncjis73bnmrj0`).

## Verified restore

The API was suspended before the final backup to prevent application and worker writes across the nine databases. No source database was deleted, reset, or modified by the migration. Each PostgreSQL custom archive and its source manifest were captured in the same exported, repeatable-read snapshot. SHA-256 checksums were checked before restoration into empty Neon databases using single-transaction restores without old role ownership or grants. Restored objects are owned by the Neon application database owner.

| Service database | Tables including bookkeeping | Rows at cutover |
| --- | ---: | ---: |
| schoolconnect_identity | 10 | 513 |
| schoolconnect_school | 9 | 93 |
| schoolconnect_content | 9 | 101 |
| schoolconnect_attendance | 8 | 24 |
| schoolconnect_files | 5 | 1 |
| schoolconnect_notifications | 7 | 46 |
| schoolconnect_audit | 3 | 120 |
| schoolconnect_read | 5 | 31 |
| schoolconnect_fees | 6 | 1 |
| **Total** | **62** | **930** |

All table row counts and sorted, duplicate-preserving row-data digests match. Columns, defaults, constraints and validation state, indexes, sequence properties and positions, views, routines, triggers, and row security flags were compared. Verification uses the same `public` search path on both systems and normalizes only PostgreSQL's equivalent whole-array versus elementwise varchar-to-text coercions in CHECK definitions. Raw manifests retain the original definitions. No other schema differences are ignored.

Nine custom archives, their SHA-256 manifests, source and target object manifests, and verification reports are stored locally outside the repository:

`C:\Users\mjish\.codex\.chatgpt-projects\g-p-6aa97c425460819181d6b1f4b4db8add\migration\final`

These backups contain database data and must remain private. Credentials are excluded from Git. No synced project reference files under `sources/` were modified.

## Connection and behavior

The only application configuration change is its base `DATABASE_URL`. The existing bootstrap continues to derive nine separate service connections; the driver, SQL, authentication keys, Kafka configuration, database pool sizes, frontend/mobile API URLs, and application code remain unchanged. `OUTBOX_POLL_INTERVAL_MS` remains `2000`.

Use the direct Neon endpoint for this application launcher because it takes a session advisory lock during startup. TLS certificate verification is enabled. The `render.yaml` binding now uses `sync: false`, so Blueprint updates do not restore the old Render connection. The Render database resource remains declared with its original free plan and external IP block.

## Rollback

The exact previous connection is retained in the API's secret environment variable `RENDER_ROLLBACK_DATABASE_URL`. No database password is included in this document.

1. Pause the API and workers to stop new writes.
2. Back up all nine Neon databases and compare changes since cutover. Render holds the migration snapshot, not subsequent Neon writes. Reconcile later writes before switching back if they must be retained.
3. In the Render API Environment settings, copy `RENDER_ROLLBACK_DATABASE_URL` into `DATABASE_URL`, save, and redeploy/resume.
4. Check `/api/v1/health/ready` and authenticated user flows. Keep both sets of backups until rollback is no longer needed.

The original Render free database expires on **2026-11-03 at 17:38 UTC**. Its preservation is therefore limited by Render's existing expiry; local backup archives remain available independently. No paid plan or upgrade is authorized or activated.

Neon's organization remains on Free. Its monthly compute and network quotas still apply. Continuous two-second polling can keep compute active; a quota exhaustion can suspend compute. The polling requirement has been preserved. Current limits: https://neon.com/docs/introduction/plans.

## Validation status

- Source remained identical to all nine exported snapshots while paused.
- All nine restored Neon databases passed schema and data verification.
- Existing Render bootstrap tests: 3 passed.
- Existing application bootstrap against Neon passed; a subsequent comparison confirmed no schema or row changes.
- Live cutover deployment `dep-db7hsrqvcj2c73dnees0` succeeded at 06:18 UTC, using the existing application commit `07d9ae85abc251ceadd2df5550cef2080ac0e89a`.
- `/api/v1/health/ready` returned HTTP 200 and `ok` for all ten internal services after the cutover.
- PostgreSQL activity showed application connections in all nine Neon service databases, and no application connections in Render. All nine Render source databases still matched their backup snapshots after the cutover.
- All nine Neon databases passed a further comparison after live startup.
- Render's live environment value for `OUTBOX_POLL_INTERVAL_MS` was confirmed as `2000` before and after saving the new connection. Other environment variables were retained through a merge update.
- The existing portal loaded its normal sign-in page with the unchanged API URL. An authenticated user login was not exercised; no passcodes were changed or new user sessions created for testing.
- Restart logs included transient Kafka group rebalances and a content-pool shutdown error from the retiring instance. No error logs appeared in the subsequent 06:19–06:22 UTC check; application code was preserved.
- The temporary `82.167.29.5/32` rule was removed; Render's database IP allowlist is empty again. The rollback database remains available on its original free plan. Neon organization plan was confirmed as Free after migration.
