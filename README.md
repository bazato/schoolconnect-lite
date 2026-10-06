# SchoolConnect Lite

One Expo/React Native application for Platform Owner, School Admin, Teacher and Parent roles, backed by a NestJS API gateway, eight database-isolated services, and a stateless authorization service. The mobile experience follows the supplied Kaksha `.fig`; product behavior and security boundaries come from the supplied product and technical specifications plus the approved owner/school administration extension.

## Implemented

- One role-aware mobile app with Owner school/account management, School Admin user/class/student lifecycle, F01–F08, login, profile/role switch, attendance/follow-ups, private-file states, drafts, upload/error/offline states
- Public API gateway with live identity, guardian-child and teacher-assignment authorization
- Independently runnable Identity, School, Content, Attendance, Files, Notifications, Audit, Authorization and Read Model services
- Eight service-owned PostgreSQL databases with no cross-database foreign keys; Authorization is stateless
- Immutable content revisions, recipient snapshots, attendance revisions, separate guardian responses, leave requests, idempotency and transactional outboxes
- Database-backed development flow for OTP, school scope, publication/editing, timeline, attendance, acknowledgement, file metadata, notifications and audit
- Configurable Identity-owned authorization provider with signed, expiring, session-bound access tokens
- Rotating refresh tokens with reuse detection, device binding and real logout
- In-process, service-owned transactional-outbox publishers that send committed events to Kafka; separate Notification, Audit and Read Model consumer groups
- Event-built Parent timeline, Teacher post feed and attendance summary read projections
- S3-compatible private-file signing
- Role-shaped Parent, Teacher and School Admin mobile BFF endpoints, in-app notification lifecycle events, and an event-driven scheduled-announcement timer
- Secure mobile session storage for non-web native builds and a typed mobile API adapter
- Encrypted native offline cache and ordered, role-scoped mutation queue with conflict review
- Scheduled/archived announcement lifecycle, broader audience grants, read reports, CSV import, academic rollover, leave review and administrator attendance escalation

The optional administration web console remains intentionally excluded.

Railway backend packaging and environment requirements are in [docs/railway-deployment.md](docs/railway-deployment.md). Deployment is separate from native app distribution; mocked OTP must not be exposed as a public production login.

The prepared Oracle Always Free trial layout and its account/security prerequisites are in [docs/oracle-free-tier-deployment.md](docs/oracle-free-tier-deployment.md). It has been tested locally but is not deployed to OCI.

Development Platform Owner login: `+919876543200` with invitation `OWNER-INVITE`. Development OTP is `123456`.

Identity owns token issuance and session validity. `AUTHORIZATION_PROVIDER` selects the token adapter; the current `local-jwt` adapter reads its signing secret, issuer, audience and access-token lifetime from environment configuration. The gateway asks the separate Authorization service for route and resource decisions; School provides live teacher/guardian relationship facts. Route and resource-role policies are configured through `AUTHORIZATION_ROUTE_RULES_JSON` and `AUTHORIZATION_RESOURCE_ROLES_JSON`. Some gateway controller role checks remain as defense in depth, so expanding role access still requires code review. Production startup fails if `AUTH_JWT_SECRET` is missing or shorter than 32 bytes. Development without a configured secret uses an ephemeral process secret, so restarting Identity invalidates existing local access tokens.

## Run locally

Requirements: Docker Desktop, Node.js 20+ and pnpm.

```text
pnpm install
pnpm infra:up
pnpm infra:broker:up
pnpm db:migrate
pnpm db:verify
pnpm build
pnpm dev:services
pnpm dev:mobile
```

Internal services bind to `127.0.0.1:3101–3109`; the public gateway uses port `3000`. If another demo instance already uses port 3000, set `PORT=3001` for the gateway and use that port in the mobile API URL. Set `EXPO_PUBLIC_DEMO_MODE=false` in `apps/mobile/.env` for database-backed login. For a physical device, set `EXPO_PUBLIC_API_URL` to the computer's LAN address (for example `http://192.168.x.x:3000/api/v1`); `localhost` points at the device itself. Development OTP is `123456`. Copy `.env.example` to a root `.env` and replace `AUTH_JWT_SECRET` before using persistent local sessions. The in-repo `apps/mobile/.env` is local and may need its LAN IP refreshed.

MinIO is an optional Docker profile because some Docker installations cannot authenticate to the Quay registry. Create the `schoolconnect-private` bucket before exercising uploads:

```text
docker compose --profile storage up -d minio
```

Kafka is now required for event delivery and read projections. The local broker is started by `pnpm infra:broker:up`; `KAFKA_BROKERS=127.0.0.1:9092` is the local default. Provision a reachable broker before updating a remote deployment. See [docs/kafka.md](docs/kafka.md).

## Verification

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:product
pnpm test:load
pnpm build
pnpm db:verify
pnpm audit --prod
```

## Sources and decisions

Untouched project sources are retained in `reference/`. `scripts/inspect-fig.mjs` decodes the original `fig-kiwi` file. Architecture and database ownership are documented in `docs/architecture.md`; unresolved school/provider decisions remain in `docs/open-decisions.md`.
