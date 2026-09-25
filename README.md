# SchoolConnect Lite

One Expo/React Native application for Platform Owner, School Admin, Teacher and Parent roles, backed by a NestJS API gateway and seven database-isolated services. The mobile experience follows the supplied Kaksha `.fig`; product behavior and security boundaries come from the supplied product and technical specifications plus the approved owner/school administration extension.

## Implemented

- One role-aware mobile app with Platform Owner school provisioning, School Admin class/teacher provisioning, F01–F08, login, profile/role switch, attendance/follow-ups, private-file states, drafts, upload/error/offline states
- Public API gateway with live identity, guardian-child and teacher-assignment authorization
- Independently runnable Identity, School, Content, Attendance, Files, Notifications and Audit services
- Seven service-owned PostgreSQL databases with no cross-database foreign keys
- Immutable content revisions, recipient snapshots, attendance revisions, separate guardian responses, leave requests, idempotency and transactional outboxes
- Database-backed development flow for OTP, school scope, publication, timeline, attendance, acknowledgement, file metadata, notifications and audit
- Secure mobile session storage for non-web native builds and a typed mobile API adapter

The optional administration web console remains intentionally excluded.

Development Platform Owner login: `+919876543200` with invitation `OWNER-INVITE`. Development OTP is `123456`.

## Run locally

Requirements: Docker Desktop, Node.js 20+ and pnpm.

```text
pnpm install
pnpm infra:up
pnpm db:verify
pnpm build
pnpm dev:services
pnpm dev:mobile
```

Internal services bind to `127.0.0.1:3101–3107`; the public gateway uses port `3000`. The mobile app starts in self-contained demo mode. Set `EXPO_PUBLIC_DEMO_MODE=false` and `EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1` for database-backed login. Development OTP is `123456`.

MinIO is an optional Docker profile because some Docker installations cannot authenticate to the Quay registry:

```text
docker compose --profile storage up -d minio
```

## Verification

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:verify
```

## Sources and decisions

Untouched project sources are retained in `reference/`. `scripts/inspect-fig.mjs` decodes the original `fig-kiwi` file. Architecture and database ownership are documented in `docs/architecture.md`; unresolved school/provider decisions remain in `docs/open-decisions.md`.
