# Managed trial deployment — 15 October 2026

The user approved rollout after the readiness report. This is a **managed trial**, not a real-school production approval: mocked OTP remains `123456`, attachments remain disabled, 100-user latency acceptance is outstanding, and permanent Android signing requires an owner decision. Keep the failed performance results visible in the [release gate](release-readiness-2026-10-15.md).

## Database protection and migration

- Pre-release snapshot: `snap-fragrant-heart-b9hy85vs`, created from `br-dry-bird-b9go12pj`.
- Isolated rehearsal branch: `br-gentle-paper-b96g2y8j` (`release-rehearsal-20261015`). All ten versioned segments of `104-event-recovery.sql` passed across all nine logical databases and were verified in their migration ledgers.
- Following rehearsal and recovery verification, migration 104 was applied to the original production branch with per-database transactions, a five-second lock timeout, a thirty-second statement timeout and an advisory transaction lock. Existing ledger entries skip reapplication. No school records, event records, offsets or credentials were deleted/reset.
- A Neon snapshot is a same-provider recovery point, not an independent offsite backup or complete disaster-recovery system. Scheduled backup/alert/retention work is still open.

## Restore-test incident and recovery

During the restore check I passed `finalize: true` while intending to inspect an isolated restored copy. Neon finalized the restore by swapping production branch names/default status and moving the existing application endpoint to the restored branch. This was not intended as a production data rollback. Rollout was paused immediately after discovering the change.

Before recovery, the original branch and restored branch were compared across all **62 public tables**, using actual row counts and sorted, duplicate-preserving row-data digests. All matched; no divergence was observed at comparison time. The manifests were checked for non-null numeric counts and 32-character hashes. No actual row values were printed.

Recovery restored `br-dry-bird-b9go12pj` to the name `production` and default status, then updated Render's protected `DATABASE_URL` to the endpoint attached to that original branch. The connection username/password/database/TLS settings were preserved; only the endpoint hostname changed. Recovery deployment `dep-db86u38u01pc73eoon3g` went live on the previous application commit, API readiness returned HTTP 200/all services healthy, and application connections were observed on the original database branch. Both branches and the snapshot remain retained; nothing was deleted.

**Current original-branch endpoint:** `ep-solitary-silence-b9zotp6a.c-7.eu-central-1.aws.neon.tech`.

The old endpoint `ep-wandering-darkness-b9x6pzxp.c-7.eu-central-1.aws.neon.tech` now belongs to restored copy `br-summer-glitter-b9k8iyd4` (`snapshot-restore-check-20261015`), **not the original production branch**. Old local migration connection records referencing that hostname are historical and must not be used for future production operations. Render's current protected connection is authoritative. Do not run another finalized restore as an isolated rehearsal; use non-finalized restoration and explicitly inspect branch/endpoint mappings before any promotion.

## Runtime selection

The existing Render Docker command remains `node scripts/start-render-demo.mjs`. The new explicit `SC_RUNTIME_MODE=managed` branch dispatches to `startManagedRuntime`, bypassing legacy migration/seed bootstrap. The compatibility bridge selects `NODE_ENV=production`, turns off demo flags, strengthens existing PostgreSQL URLs to certificate-verifying TLS, and retains the existing Identity issuer/audience defaults only when explicit values are absent. Custom issuer/audience, JWT/internal secrets, effective passcode pepper, Kafka credentials/topic/groups and polling remain unchanged.

The protected Render configuration must explicitly select trial stage/mock allowance, policy authorization, HTTPS origins, disabled attachments/scanner and the existing authenticated TLS Kafka topic. Strict configuration and read-only schema readiness run before service startup. The bridge does not apply DDL or seed users.

## Remaining verification

Record deployed source SHA, API/web deployment IDs, readiness and managed startup log here after rollout. Do not claim the permanent-signed APK exists until its signing certificate and installation behavior have been verified. See the [signing audit](release-readiness-2026-10-15.md) for the prior debug-signed APK and unresolved production gates.
