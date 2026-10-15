# Managed runtime and production configuration — step 2

This is production **configuration preparation**, not a declaration of production readiness. `NODE_ENV=production` turns on strict settings, but `DEPLOYMENT_STAGE=trial` plus `ALLOW_MOCK_OTP=true` is the user-approved synthetic-data-only exception. Mock `123456` also enables passcode recovery without proving phone possession. Do not use real children, school or fee data. The stage cannot be `production` with mocked OTP, even if the opt-in flag is set. A live OTP adapter is not implemented yet.

## Separation from the existing trial

- The existing `render.yaml` and demo launcher are unchanged. The live deployment is not switched by this work.
- `render.production-trial.yaml` is an alternative profile for the same existing services and URLs, with no new paid resources. Do not sync both profiles as different Blueprints owning the same resources.
- `scripts/managed-runtime.mjs` resolves nine service database connections, validates configuration, then checks migrations/tables using read-only transactions. It never creates databases, seeds, or applies migrations.
- Existing secrets, issuer/audience and passcode pepper must be preserved. A missing separate pepper retains the existing JWT-secret fallback; do not assign a newly generated pepper to existing accounts. Future secret/pepper rotation needs a separate migration/reset plan.
- The managed deployment retains the single-container/shared-process topology to preserve the existing free-hosting architecture. Internal HTTP listeners bind only to loopback. Independently deployed services use `scripts/start-service.mjs` with per-service configuration validation. This does not add a worker or independently scale services.
- The two-second outbox publisher setting, Kafka groups/topic, authentication flows and app URLs are unchanged. Configuration code does not migrate school records or add default users.

## Required settings

Use `.env.production-trial.example` as a non-secret checklist, not usable credentials. Populated `.env.*` files are ignored by Git and Docker. Inject actual settings through protected Render configuration; do not put secrets in YAML, documentation, screenshots or command arguments. `sync: false` preserves existing values but does not prompt for new settings during Blueprint updates. Enter new values in the existing service's protected environment before selecting the new launcher.

Required: `NODE_ENV=production`, explicit stage, distinct protected `AUTH_JWT_SECRET` and `INTERNAL_SERVICE_TOKEN`, supported authorization providers, HTTPS-only CORS origins, `ENFORCE_HTTPS=true`, authenticated TLS Kafka with an already provisioned topic, and verified PostgreSQL TLS (`sslmode=verify-full`). Weak placeholders, demo flags, malformed rate/time settings and TLS bypasses fail startup. Preserve current JWT issuer/audience; changing them changes token verification semantics.

The launcher accepts either nine explicit service-specific URLs or derives them from the existing base `DATABASE_URL`. Explicit URLs win and permit per-service restricted roles. The existing migration restored objects under the application owner; runtime-role least-privilege grants are NOT claimed implemented by this configuration change. Provision/review those separately before real-data launch. For the current scheduled-announcement `LISTEN` connection and release migrations, use direct Neon endpoints, not transaction poolers.

`FILE_STORAGE_PROVIDER=disabled` is an explicit unavailable capability until step 5. Upload, completion and download return `503 FILE_ATTACHMENTS_DISABLED` before file-record writes or signing; the gateway preserves that status. No mock-clean scanner is accepted in production mode. Genuine production refuses disabled attachments. R2 plus a real scanner must be implemented and tested before enabling them. The existing development S3 adapter remains available outside the managed profile.

## Deliberate release migrations

Build first: `pnpm --filter @schoolconnect/contracts build` and the services' normal builds.

1. Back up all nine databases and test the release on an isolated copy. Stop/reconcile writes if a migration requires a maintenance window.
2. `pnpm db:managed:plan` lists existing versioned migration segments without contacting PostgreSQL. It excludes `090-development-seed.sql`.
3. Supply `MIGRATION_DATABASE_URL` to the operator's protected environment using a direct, TLS-verifying admin connection. Do not inject it into the API runtime.
4. Run `pnpm db:managed:apply` only after release approval. It serializes migration runners with an advisory lock, requires all nine databases already provisioned, and reuses the existing `render_demo_migrations` ledger. Each unapplied segment commits atomically with its ledger entry. There is no all-nine-database atomic transaction, and there is no automatic rollback of DDL; retain backups and a release recovery plan.
5. Run `pnpm runtime:check` with the managed runtime settings. This reads schema and ledger state; it does not start services or seed data.
6. Start with `pnpm start:managed` after checks pass. Pending migrations prevent startup instead of being silently applied.

The current `render_demo_migrations` name is preserved for compatibility with the verified Neon restore; this is bookkeeping, not automatic seeding. A schema gate is not exhaustive drift or data-integrity verification; migration verification/backups are separate requirements.

## Cloud cutover (not performed automatically)

Confirm the new code/image and protected configuration are present before changing the command. Preserve the current database connection, Kafka credentials, JWT secret, internal token, effective pepper, issuer/audience and frontend URLs. Configure new stage/mock opt-in settings explicitly, disable demo flags, set HTTPS-only origins, and acknowledge attachments are unavailable in this profile. Then select `node scripts/managed-runtime.mjs` and deploy during an agreed window. Verify all services, login/passcode recovery, school/teacher/parent scopes, publishing and fees reports on synthetic accounts. Runtime checks alone are not full acceptance testing.

For code/config rollback, restore the prior launcher and trial settings together while keeping the current Neon database. Switching back to the old Render database is a separate data rollback: it does not contain subsequent Neon writes. Follow `docs/neon-migration.md` and reconcile later writes first. Never delete either database as a deployment cleanup step.

## Still pending beyond step 2

Live OTP, automated off-site backups/restore drills, stronger administrator authentication, dependency advisory fixes, least-privilege database roles, Kafka failed-event handling/alerts, Cloudflare R2 and real malware scanning, FCM/APNs, hosted mixed-workload and physical-device acceptance tests, production release signing, operational monitoring/runbooks, and approved privacy/retention policies remain separate readiness gates. No paid plan, cloud environment change, secret rotation or APK release is part of this implementation.

## Verification — 2026-10-14

- Full workspace lint, TypeScript checks, unit/component tests and builds passed (all backend services, admin portal and Expo web export). No native APK/IPA was generated.
- Startup/migration script suite: 10 passed, including the 3 existing demo-bootstrap regressions. Tests verify nine-database separation, loopback internal wiring, read-only schema checks, missing-migration rejection, secret-safe errors and seed-free migration planning using fixture clients.
- Both Render profiles passed validation against the current official Render JSON Schema.
- Docker-backed database/Kafka integration and production-mode hosted acceptance tests were not run: the local Docker engine was not running. Existing live Neon and Render configuration were not changed. Schema fixtures are not a substitute for a live migration/cutover acceptance test.
