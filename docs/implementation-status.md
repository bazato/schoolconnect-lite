# Implementation status

## Complete in the local development stack

- Seven isolated PostgreSQL databases and versioned initialization scripts
- NestJS gateway plus Identity, School, Content, Attendance, Files, Notifications and Audit services
- Database-backed development OTP/session, school scope, child scope, publishing, timeline, attendance, acknowledgement, leave request, file metadata, notification inbox and audit storage
- Transactional idempotency and outbox writes for critical Content and Attendance mutations
- Mobile non-demo login, native secure session storage, live child list and live parent timeline
- Teacher post corrections with immutable revisions, optimistic conflict checks, owner/assignment authorization and parent-visible `Updated` state
- Platform Owner mobile workflow for creating schools and their first School Admin account
- School Admin mobile workflow for creating classes and invitation-only Teacher accounts with scoped permissions
- Phone-bound, expiring invitation generation and invitation-specific role resolution during OTP login
- Automated gateway authorization tests, mobile scoping tests, lint, typecheck and builds

## Deliberately mocked or awaiting an external provider/decision

- SMS delivery and production JWT/rotating-refresh implementation; development OTP remains `123456`
- S3 object bytes, signed URLs and malware scanner; the Files service currently persists quarantine/upload state
- APNs/FCM transport; Notifications persists authoritative inbox records
- Broker/outbox relay and automatic Notification/Audit consumers; outbox records are committed but provider workers are not yet connected
- Bulk student/guardian roster import and School Admin parent-link provisioning; public self-registration remains intentionally disabled
- Signed Android/iOS store artifacts, production secrets, hosting, monitoring, backup drills and load testing

These items are adapter or operational integrations. They do not require services to share databases or introduce cross-service foreign keys.
