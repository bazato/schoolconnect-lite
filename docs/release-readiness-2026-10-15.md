# Release gate: 15 October 2026

**Decision: HOLD. No new source commit, GitHub push, cloud schema mutation, runtime cutover, APK signing or deployment was performed in this execution.** The user authorized deployment only if ready. Correctness evidence improved, but performance, storage, schema, backup and signing gates remain open. Mock OTP and the 2-second outbox polling setting are unchanged. All new business fixtures and failure injection were confined to a separate local Docker stack.

## Verification performed

| Check | Evidence and outcome |
| --- | --- |
| Workspace tests | 367 passed, with 21 database cases initially skipped. All 21 subsequently passed on real isolated PostgreSQL: 7 recovery, 7 passcode, 7 fees. Total distinct workspace cases verified: **388**. |
| Runtime/migration/R2 harness tests | **18 passed**, including eight fake-storage smoke-harness tests. These eight are not live R2 tests. |
| Lint / TypeScript / workspace build | All passed, including backend services, admin Vite build and Expo web export. The Expo web export is not an APK/IPA. |
| New release scripts | Ran on a separate local API backed by real PostgreSQL 17.11 and Kafka 4.3.1. Syntax checks passed. |
| Security API E2E | Passed atomic OTP consumption, refresh rotation/reuse revocation, owner-to-admin provisioning, roster-scoped attendance, notification delivery, concurrent acknowledgement idempotency, cross-tenant denial and logout revocation. |
| Product API E2E | Passed account lifecycle, teacher/parent/class configuration, grade publishing, read reports, archive, scheduled announcements, CSV/student/guardian lifecycle, Excel result preview/publish, leave review, attendance corrections, reports, rollover and suspension. |
| Administrator/mobile-contract regression | Passed class/teacher/student edits, two teacher assignments, actions across both classes, cross-class isolation, duplicate assignment protection, sibling reuse, school name resolution, archived-class denial and cross-school authorization. Not a physical-device visual test. |
| Fees API E2E | Passed import/update/idempotent retries, grade/date reports, wrong-role denial, stale-revision conflict and 100 concurrent report reads (2721 ms total for that batch, not p95 and not 100 independently authenticated users). |
| Mixed distinct-user load | Two runs: each had **100 separate authenticated parent accounts**, 500 reads, and two concurrent teacher publishes. Both returned **500 HTTP 200 responses, zero failed reads**. Both failed the strict local p95 < 3000 ms criterion. Details below. |
| Kafka failure injection | Dedicated local broker only. Outbox persisted a published announcement while Kafka was stopped; restart/retry delivered it to its parent. Malformed bytes were quarantined independently in Notifications, Audit and Read while a later valid event still delivered. Duplicate verification waits for all three groups' committed offsets to pass the duplicate, then checks database effects. |
| Migration SQL | Fresh isolated PostgreSQL bootstrap executed all SQL including 104 successfully; recovery tests also reapplied its affected segments. Migration plan passed. This is not a migrated copy of Neon production data or a cloud restore drill. |
| R2 live smoke | **Blocked**: Git-ignored local `.env.r2-test` has no keys. User saved keys in Render; available connectors cannot execute code there or read these secrets. No secrets were logged or copied to Git. No real R2 object was created by these tests. |
| Dependency audit | **2 high, 0 critical**, unchanged upstream `node-forge` and `braces` findings. Audit exit code is nonzero; not waived or hidden. See step-3 security document. |

### Distinct-user load results

| Metric | Run 1 | Run 2 |
| --- | ---: | ---: |
| Separate parent sessions | 100 | 100 |
| Read requests | 500 | 500 |
| Concurrent teacher writes | 2 | 2 |
| Failed reads | 0 | 0 |
| Elapsed workload | 9646 ms | 11824 ms |
| p50 | 1540 ms | 1588 ms |
| p95 | **3377 ms** | **4135 ms** |
| p99 | 3455 ms | 4345 ms |
| Maximum | 3749 ms | 5047 ms |

Run 2 endpoint p95: `/me/context` 4256 ms, `/bff/parent/home` 4343 ms, `/timeline/:studentId` 2022 ms, `/notifications` 1480 ms, `/me/children` 1276 ms. Each endpoint had 100 samples. Functionally, run 2 also verified both class projections received their posts and parent/school-admin accounts were denied owner operations. The harness deliberately exits nonzero on the failed latency gate; the threshold was not relaxed. Run 1's early latency assertion prevented its later delivery checks; the harness was improved to complete those checks before asserting performance in run 2.

This is API acceptance on Windows Node 24.16.0 with separate service processes, local Docker and development test configuration. It does not establish 100-user capacity on Render's single-container Node 22 runtime, mobile rendering performance, store readiness, TLS/SASL recovery on Aiven, or capacity with production security/pool settings. Tune/profile the context/home authorization and service-call paths, rerun with realistic ramp-up and sustained traffic, then repeat on a production-mode staging deployment. Do not bypass authorization or raise the budget to hide a failed result.

## Cloud checks (read-only)

- Render API `schoolconnect-demo-api` remains on commit `07d9ae85abc251ceadd2df5550cef2080ac0e89a`, deployment `dep-db86afks728c738bgqpg`, status `live`. That earlier deployment saved R2 settings; it did not include these local hardening changes.
- Live API readiness returned HTTP 200 with all ten downstream services `ok`. One probe timed out at 15 seconds; a later retry returned 200. No conclusion about its cause or production latency is drawn from these isolated probes.
- Explicit last-hour Render error-log query returned zero records at the time checked. Earlier unbounded log results included historical errors and were not treated as current incidents.
- Latest returned infrastructure sample was 2026-10-15 05:50 UTC: CPU 0.040917635 against 0.15 CPU limit (~27.3%); memory 84,443,140 bytes (~80.5 MiB) against 512 MiB (~15.7%). Available-window peak CPU was 0.0442721 (~29.5%). No HTTP latency/count series was returned. These are sparse, non-load-test observations, not continuous alerting or proof of spare capacity under 100 users.
- Neon read-only checks on the existing production branch found `schoolconnect_read.consumer_failures` absent, both new read receipt columns absent, and all three new content outbox recovery columns absent. **Migration 104 must not be assumed applied.** No cloud SQL was changed.

## Signing audit

Android SDK `apksigner` verified `dist-native/nexqon-school-app-0.1.2-passcode.apk` successfully using the APK v2 signature scheme. The signer is **CN=Android Debug**, not a production key. A JAR-only verification is insufficient for a v2-only APK and is not used to declare it unsigned.

- APK bytes: 45,628,066.
- APK SHA-256: `54abef95970f21cc8389d9a8ea890bbdbddb724a6c95fc435626f05d79897747`.
- Signing certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- App version 0.1.2, Android versionCode 3, package `com.schoolconnect.lite`.
- Generated Gradle release config still selects the debug certificate. No private production signing key or backup/custody decision has been supplied. No new key was generated, existing key rotated, release version bumped, or APK built/uploaded.

Before production signing: the owner must choose an existing release/upload keystore or approve creation and protected backup of a permanent one. Use secret-injected signing configuration retained through Expo prebuild, increment versionCode, build the intended APK/AAB, verify its certificate fingerprint with `apksigner`, test installation/update on devices and retain a recovery backup. Never publish keystores or passwords. A differently signed APK cannot directly update the existing debug-signed app; plan that transition without silently deleting local app data. iOS signing/device/store validation remains separate.

Authoritative guidance: [Android signing](https://developer.android.com/studio/publish/app-signing), [Expo config plugins](https://docs.expo.dev/config-plugins/plugins/).

## Remaining deployment gates, in execution order

1. **Storage:** implement genuine malware scanning and immutable scan/promotion; enforce actual size/type/checksum validation, quota/reservations and orphan cleanup; verify private bucket/r2.dev settings and exact web CORS; run the real R2 and application authorization flows. Do not substitute `development-clean` in production.
2. **Performance:** investigate the measured context/home latency; pass the agreed staging SLO under 100 distinct sessions, writes, polling, retries and sustained load. Current local p95 gate failed twice.
3. **Recovery and schema:** take protected backups of all nine Neon databases, rehearse restoration and migration on an isolated Neon copy, then apply versioned migration 104 through the operator-only workflow. A fresh local schema is not that rehearsal.
4. **Runtime:** preserve existing JWT/internal secrets, passcode pepper, Kafka credentials/groups/topic and URLs; configure the strict managed **trial** settings and explicit mock OTP allowance. Disable attachments until real scanning is ready. Check schema readiness before switching launchers. Never silently run demo seed/bootstrap in production.
5. **Deploy:** only after the relevant gates pass, commit/push the intended scoped changes, deploy API/web, check migrations/version/readiness, and rerun hosted E2E/load/Kafka diagnostics. Updating environment variables through the Render connector automatically deploys; it has no save-only control.
6. **Monitoring:** provision an approved notification destination and real alerts for availability/errors/latency, memory/CPU, oldest pending outbox age, quarantines and broker-side consumer lag. Validate alert delivery. Existing diagnostic endpoints and this one-time monitoring snapshot are not alerts. See [operations runbook](operations-readiness.md).
7. **Distribution:** complete owner-controlled permanent Android signing, device/update tests and store/privacy/retention approvals. Keep mock OTP clearly trial-only; replace it before real-school production launch. FCM/APNs delivery and iOS release remain unverified.

## Reproduce local acceptance without touching the existing app

```powershell
docker compose -f infra/testing/compose.yaml up -d
pnpm build
node scripts/start-local-test-stack.mjs --release-isolated
```

In a second terminal:

```powershell
$env:TEST_API_URL='http://127.0.0.1:3390/api/v1'
node scripts/integration-test.mjs
node scripts/product-test.mjs
node scripts/admin-mobile-regression.mjs
node scripts/fees-regression.mjs
pnpm test:release:concurrency
pnpm test:release:kafka
```

Do not run concurrency and broker-stop tests simultaneously. The new scripts refuse any API except the exact local isolated port; the Kafka test verifies the container's Compose ownership before stopping it. The first launch creates separate volumes and runs synthetic seed data only there. PostgreSQL is bound to 127.0.0.1:55432 and Kafka to 127.0.0.1:19092. Existing containers and live Neon/Aiven data are not used. Stop the launcher with Ctrl+C and the two test containers with `docker compose -f infra/testing/compose.yaml stop`. Volumes and synthetic fixtures are retained for investigation; no existing app volume is deleted.

Real storage connectivity is separately documented in [R2 testing](r2-testing.md). Its local secret file is Git-ignored. Do not include secrets in commands, reports or screenshots.
