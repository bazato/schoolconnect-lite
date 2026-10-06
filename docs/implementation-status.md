# Implementation status

## Current local architecture (2026-10-06)

- Docker PostgreSQL and Kafka are running locally. Eight isolated databases include the new `schoolconnect_read`; migrations through `101-read-model-backfill.sql` are applied.
- A separate stateless Authorization service decides gateway routes and guardian/teacher resource access using configurable rules and live School facts. Gateway controller checks still restrict some role expansions; the external policy is not yet the sole place to change every role behavior.
- The standalone worker package has been removed. Each owning service sends its own committed transactional outbox to Kafka. Independent Notification, Audit and Read Model consumers build the in-app inbox, audit history and post/attendance projections.
- Parent timeline, Teacher post feed and school attendance summary now use event-built projections. Historical posts and current attendance were backfilled; local source/read counts matched when checked. Other BFF data still comes from source services.
- More School administration changes and Identity role switching now emit audit events in the owner-service transaction. Kafka delivery remains asynchronous, so audit/read visibility may lag a successful business response.
- The local integration suite (8/8), product suite (9/9), unit tests, lint, typecheck, application build and backend Docker image build passed during this change. A 100-client/500-request local synthetic load check had zero failures and p95 around 1.7 seconds; this is not production-capacity certification.
- After the latest product run, Content and Read Model each contained 70 posts, Attendance and Read Model each contained 26 current attendance rows, and the three active Kafka consumer groups had zero lag. An obsolete pre-migration consumer group remains registered with lag but has no active members or role in this version.
- The current remote demo has **not** been upgraded to this Kafka-required version. It needs a reachable broker, deployment configuration, migration and monitoring work first. No separate worker is needed.

## Open hardening after this change

- Move or remove remaining controller-level role checks only after preserving all resource and tenant checks, so policy configuration can safely change role grants without code edits.
- Event-build remaining read surfaces where justified, add projection rebuild/replay tooling and stronger event schema evolution tests.
- Add Kafka lag/outbox-age alerts, dead-letter/recovery handling and operational readiness checks; run failover and larger distinct-user load tests.
- Configure real OTP/SMS, mobile push, malware scan and private object storage; finish device/offline QA, backups, TLS/secrets, native signing and deployment.

The sections below record earlier implementation history and may mention the removed worker or prior database fallback. The current architecture above and `docs/architecture.md` supersede those historical statements.

## Local product workflows implemented

- One Expo/React Native app for Owner, School Admin, Teacher and Parent roles, backed by a public gateway and seven database-isolated NestJS services
- Owner school creation, suspension/reactivation, additional owner and school-admin accounts, invitation reissue, cross-school counts and audit view
- School Admin class, teacher, parent, student and guardian provisioning; edit/deactivate/reactivate accounts; teacher and student reassignment; guardian-link control; CSV preview/import; academic-year rollover
- Teacher homework, result and announcement publishing/editing with immutable revisions; class/subject selector; archive/unpublish; scheduled announcement edits; class, grade and school audiences and urgent announcements behind school/assignment grants; recipient and recorded read/delivery reports
- Server and encrypted native local draft restoration, attachment metadata/recovery and ordered draft-save cleanup after publication
- Live attendance, versioned teacher corrections, School Admin escalation with a recorded reason, follow-ups, parent absence acknowledgement/reason/leave note, and School Admin leave approval/rejection
- Parent child switcher, per-child timeline, attendance history, notifications/deep links and private file preview
- Native AES-GCM encrypted, user/school/membership-scoped 24-hour cache for permitted parent/teacher reads; queued attendance, absence response and eligible post mutations; ordered replay with conflict stop, review and discard; secure deletion on logout. Results and private attachments are not cached for offline viewing.
- School-level attendance and notification summaries plus cross-school operational counts and recent audit entries
- Development OTP remains intentionally mocked as `123456` per owner direction

## Verification completed locally

- On 2026-10-05, migrations through `099-notification-lifecycle.sql` applied to the local PostgreSQL service. Typecheck, ESLint, unit suites, all eight integration flows and all nine product workflows passed against updated local services in both database-worker and Kafka-worker modes. After the Identity/School audit and event-snapshot additions, the Kafka-mode suites, build and 100-client test passed again; the consumer group reached zero lag and corresponding notification/audit records were observed.
- Earlier verification: Typecheck, ESLint and unit suites passed (mobile, API, Identity, Attendance and Files). Product verification was dated 2026-09-28.
- Eight integration security/concurrency flows and nine end-to-end product flows pass, including school suspension and cross-tenant checks
- Web, Android and iOS JavaScript exports compile on 2026-10-05; these are bundles, not signed store binaries
- Local watch-mode load test: 100 concurrent clients, 500 requests, zero failures; p95 1.652 seconds on the latest run. Clients share a synthetic parent session; this is not a 100-distinct-account or production-capacity certification.
- PostgreSQL migrations through `099-notification-lifecycle.sql` applied successfully locally

## Architecture work added 2026-10-05

- Shared versioned event catalog, request-to-worker correlation propagation, tenant-scoped file completion, and a configurable gateway resource-authorization adapter. School creation, teacher assignment and guardian linking now emit service-owned outbox events for audit.
- Identity's pre-existing account-provisioning outbox is now consumed. Membership updates/revocations and invitation reissues emit transactional outbox events without placing invitation codes or phone numbers on Kafka. School updates, class upserts and academic-year rollovers also emit transactional audit events. Older unprocessed Identity events were drained into Audit locally.
- Invitation reissue and membership revocation were exercised on a product-test-created account; matching actor/correlation audit records appeared. The latest Kafka consumer lag was zero.
- New Content and Attendance events include notification-ready post text or a guardian snapshot. The consumer uses those fields without querying Content/School, while older events retain a lookup fallback.
- Kafka relay/consumer implementation and a running local Docker broker. The local integration and product suites verified broker publication, consumer processing, zero lag, and notification/audit side effects. The existing database-mode worker stays available until a broker is operational in the selected hosting environment.
- OTP request rate limiting now clears an expired temporary block when the request window rolls over. A local runtime regression check set an expired window with a future stale block and confirmed a subsequent OTP request succeeded and cleared that block.
- Dedicated Notification service emits transactional created/read lifecycle events and records in-app delivery attempts. The delivery report now counts persisted in-app notifications correctly; this does not imply push-device delivery.
- Parent, Teacher and School Admin read-only BFF endpoints; the Teacher mobile feed uses its BFF with membership-scoped offline caching.
- Content's scheduled-post runner uses PostgreSQL `LISTEN/NOTIFY` plus a durable due-date query on startup/reconnect, instead of the worker's two-second due-date check.
- Attendance's current-state pointer can be compared with its immutable event history through a school-scoped consistency endpoint. A confirmed School Admin repair can rebuild the current projection transactionally from that history. This was tested by corrupting one row in a test-created school, repairing it, and verifying the outbox/audit event. Full event sourcing/replay remains unfinished.

## Remaining hardening and external dependencies

- The current Render trial has not been updated with the 2026-10-05 changes. Kafka mode cannot be enabled there until a reachable broker is provisioned. See `docs/kafka.md`.

- No real SMS OTP, APNs/FCM transport, production malware scanner or provisioned production S3 bucket/provider. The notification inbox/outbox and provider abstractions are in place.
- Local private-object storage cannot currently start because its MinIO image registry returns HTTP 401. Upload/private-download end-to-end verification remains blocked; metadata/signing abstractions alone do not prove the full storage workflow.
- Token/session authority is centralized in Identity and uses a configurable token adapter. Route-role checks remain in the gateway and teacher/guardian relationship policies in School; a fully externalized authorization policy service remains pending.
- Older Kafka/outbox events still require Content/School lookups during replay. New post and attendance events are self-contained for notification delivery, but CQRS read projections are not implemented. School still owns classes, enrolment and relationships rather than separate extracted services.
- The gateway still records some admin actions after the business operation, so not every admin mutation has a service-owned transactional audit event. Identity account/membership/invitation actions and selected School actions now do; remaining School/admin mutations need coverage before production.
- The offline store supports critical Teacher/Parent reads and queued mutations, not a complete local relational replica. School administration remains online-only; private results and attachment downloads remain online-only by privacy design. Native device/offline/reconnect QA is still required.
- Reports provide operational counts and recent audit, not historical trend charts, CSV/PDF exports or a full BI warehouse.
- Content, School, Notifications, Audit and worker services still need deeper isolated unit suites; their critical cross-service flows are covered by the product and integration tests.
- Hosting, TLS, secrets, real provider contracts, staff MFA decision, backups/restore drill, monitoring, retention, localization/accessibility QA, native signing and store submission remain outside the local implementation.
- `pnpm audit --prod` currently reports five advisories in Expo/React Native transitive tooling (`brace-expansion`, `node-forge`, `braces`); two packages have no published patched version in the audit report. This was not hidden or overridden with an untested transitive version change. Re-audit and upgrade the mobile SDK dependency tree before a production release.

Pilot-dependent choices remain in `docs/open-decisions.md`; none have been silently fixed to a production value.
