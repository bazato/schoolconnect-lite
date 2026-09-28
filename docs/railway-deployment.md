# Railway deployment

## Layout

Deploy the existing backend as separate Railway services from this repository. The same Dockerfile compiles the backend packages; `SERVICE_NAME` selects one process at runtime. It does not combine the services or their databases. The Expo mobile app is still the only client application; publishing Android/iOS binaries is separate from hosting its API.

| Railway service | `SERVICE_NAME` | Listening port variable | Database URL variable |
| --- | --- | --- | --- |
| Gateway | api | PORT | None |
| Identity | identity | IDENTITY_PORT=3101 | IDENTITY_DATABASE_URL |
| School | school | SCHOOL_PORT=3102 | SCHOOL_DATABASE_URL |
| Content | content | CONTENT_PORT=3103 | CONTENT_DATABASE_URL |
| Attendance | attendance | ATTENDANCE_PORT=3104 | ATTENDANCE_DATABASE_URL |
| Files | files | FILE_PORT=3105 | FILE_DATABASE_URL |
| Notifications | notifications | NOTIFICATION_PORT=3106 | NOTIFICATION_DATABASE_URL |
| Audit | audit | AUDIT_PORT=3107 | AUDIT_DATABASE_URL |
| Workers | workers | No HTTP listener | None |

Set `SERVICE_BIND_HOST=::` for internal HTTP services. Keep Identity, School, Content, Attendance, Files, Notifications, Audit and Workers private; only the gateway should have an application-facing domain. Configure the gateway and workers with the applicable `*_SERVICE_URL` values pointing at the internal service DNS names and ports. Set a shared random `INTERNAL_SERVICE_TOKEN` of at least 32 characters on communicating services.

Every service uses its own PostgreSQL database and production database credential. Do not point every `*_DATABASE_URL` at the same default database. Provision and inspect the databases before applying `infra/postgres/init` schemas and migrations. Existing databases must be backed up and checked first. The local Docker migration command is not a Railway migration command. Do not copy the local development seed into a production database.

## Configuration

- Store secrets in Railway variables, not GitHub: database URLs, `AUTH_JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`, and S3 access keys.
- Identity requires its JWT issuer, audience, token lifetime settings and a persistent signing secret. Repository `.env.example` values are examples, not deployment credentials.
- Set the gateway's `CORS_ALLOWED_ORIGINS` explicitly for any browser-based test preview and `ENFORCE_HTTPS=true` for external deployment.
- Files needs a private S3-compatible bucket, provider endpoint/region and credentials. The local MinIO registry pull currently returns 401, so local end-to-end storage verification remains blocked.
- Keep `NODE_ENV=production` for a production deployment. Development OTP deliberately refuses production requests; do not remove that protection to make a production login work. The development-clean scanner also refuses production upload completion.
- A mocked-OTP deployment may contain only synthetic data and must have restricted external access. Do not expose predictable demo-owner login publicly. Access restriction and the test environment must be agreed before making it public.
- Compile the mobile app with `EXPO_PUBLIC_DEMO_MODE=false` and the deployed HTTPS `EXPO_PUBLIC_API_URL`. No private server credential belongs in an `EXPO_PUBLIC_*` variable.

## Deploy and verify

Railway can build the root Dockerfile from GitHub; `railway.json` specifies the backend start command. Set each service's `SERVICE_NAME` and variables before deploying. The shared configuration does not auto-create services, provision databases, seed accounts or grant public access.

For the gateway, configure healthcheck path `/api/v1/health/ready`. It returns HTTP 503 if any backend/database health check fails. The normal `/api/v1/health` endpoint provides diagnostic status and can return HTTP 200 with a degraded report; it is not the deployment readiness check. [Railway healthcheck documentation](https://docs.railway.com/deployments/healthchecks).

After deployment, verify all seven backend health checks, migrations, an authorized synthetic teacher/parent publishing flow, school isolation and the notification worker. Verify private storage separately using an actual provider before declaring uploads operational. Mocked OTP, production push delivery and native store binaries must not be described as production-complete.

See [Railway monorepo guidance](https://docs.railway.com/deployments/monorepo) and [Dockerfile guidance](https://docs.railway.com/builds/dockerfiles).
