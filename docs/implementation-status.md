# Implementation status

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

- Typecheck, ESLint and unit suites pass (mobile, API, Identity, Attendance and Files). Latest product verification is dated 2026-09-28.
- Eight integration security/concurrency flows and nine end-to-end product flows pass, including school suspension and cross-tenant checks
- Web, Android and iOS JavaScript exports compile; these are bundles, not signed store binaries
- Local watch-mode load test: 100 concurrent clients, 500 requests, zero failures; p95 1.67 seconds on the latest run. Clients share a synthetic parent session; this is not a 100-distinct-account or production-capacity certification.
- PostgreSQL migrations through `097-publishing-permissions.sql` applied successfully

## Remaining hardening and external dependencies

- No real SMS OTP, APNs/FCM transport, production malware scanner or provisioned production S3 bucket/provider. The notification inbox/outbox and provider abstractions are in place.
- Local private-object storage cannot currently start because its MinIO image registry returns HTTP 401. Upload/private-download end-to-end verification remains blocked; metadata/signing abstractions alone do not prove the full storage workflow.
- Token/session authority is centralized in Identity and uses a configurable token adapter. Route-role checks remain in the gateway and teacher/guardian relationship policies in School; a fully externalized authorization policy service remains pending.
- Admin audit writes are recorded by the gateway after a successful operation, but are not transactionally coupled to the owning service. An audit outage can leave an administrative action without an audit event; service-owned admin outboxes are required before production.
- The offline store supports critical Teacher/Parent reads and queued mutations, not a complete local relational replica. School administration remains online-only; private results and attachment downloads remain online-only by privacy design. Native device/offline/reconnect QA is still required.
- Reports provide operational counts and recent audit, not historical trend charts, CSV/PDF exports or a full BI warehouse.
- Content, School, Notifications, Audit and worker services still need deeper isolated unit suites; their critical cross-service flows are covered by the product and integration tests.
- Hosting, TLS, secrets, real provider contracts, staff MFA decision, backups/restore drill, monitoring, retention, localization/accessibility QA, native signing and store submission remain outside the local implementation.

Pilot-dependent choices remain in `docs/open-decisions.md`; none have been silently fixed to a production value.
