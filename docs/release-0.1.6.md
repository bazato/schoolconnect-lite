# Nexqon School App 0.1.6

Android versionCode: 7. Application ID remains `com.schoolconnect.lite`. The permanent signing identity is unchanged; no private signing material is stored in Git.

## Included

- Separate school/role memberships sharing a phone number and four-digit passcode, with explicit registered-role login selection.
- Generated school/class/student identifiers and predefined subject identifiers; expanded owner and school account management, phone corrections and authorized activation-code redisplay.
- Administrator announcements to parents across all active classes and the school's active teachers. Web publishing/editing/archive, mobile administrator publishing, and read-only teacher notices/notifications.

The proposed welcome-screen simplification (authenticate first, choose a workspace afterward only when needed) is **not** included; it awaits approval. Mock OTP `123456` and disabled attachments remain trial limitations. This release is not a full production/security/store sign-off.

## Verification before release

- 158 gateway/API tests, 66 mobile tests, 32 web tests, four notification-consumer tests, five School tests, two Content tests, 15 managed-runtime/migration tests and five Android-signing tests passed. Previous account hardening suites are documented separately.
- Six affected targets passed lint/type checks; backend/web builds and Android Hermes export passed. Sixteen isolated real PostgreSQL/Kafka acceptance scenarios passed, including cross-class notification delivery, tenant isolation, idempotency, editing and archive behavior. No physical-device acceptance is claimed.
- Migrations 105 and 106 were rehearsed on Neon branch `release-016-20261016` (`br-fragrant-poetry-b9jqrnwa`), then applied transactionally per database to the existing production branch. Counts stayed at 26 users, 27 memberships, 13 students and 15 posts. No business records were created/edited/deleted by the migrations.
- The snapshot quota was already full. Existing snapshots were preserved; untouched no-compute branch `before-016-20261016` (`br-rough-hat-b98nb9k1`) was retained as a pre-migration recovery point. This is a same-project branch, not an independent/off-site backup. Rehearsal compute uses 0.25 CU; suspend configuration was left at the account-permitted default. Review temporary branch retention after release.

## Deployment

Existing Render services: `schoolconnect-demo-api` (`srv-db18uebncjis73bnmrj0`) and `schoolconnect-demo-admin` (`srv-db37r8om7kps73dbnbo0`) in the user-confirmed My Workspace. Both automatically deploy commits to `main`; do not trigger a redundant manual deployment after pushing.

Preserve existing database URLs, JWT/internal secrets, passcode pepper, Kafka credentials/topic/groups, R2 configuration and two-second outbox polling. No Blueprint sync, plan upgrade or automatic demo reseeding is part of this release.

Final deployed commit, APK checksum/certificate and deployment verification are recorded in the release handoff after the build/deploy completes.
