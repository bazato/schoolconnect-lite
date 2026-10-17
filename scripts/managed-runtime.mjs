import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MIGRATIONS, parseMigrationSegments } from './render-demo-db.mjs';
const requireService = createRequire(new URL('../services/identity/package.json', import.meta.url));
const { resolveServiceDatabases, validateManagedRuntime, serviceDatabases } = requireService('@schoolconnect/contracts');
export const runtimeServices = ['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit', 'authorization', 'read-model', 'fees', 'api'];
const internalPrefixes = ['IDENTITY', 'SCHOOL', 'CONTENT', 'ATTENDANCE', 'FILE', 'NOTIFICATION', 'AUDIT', 'AUTHORIZATION', 'READ', 'FEES'];
export const requiredTables = {
  identity: ['users', 'memberships', 'invitations', 'otp_challenges', 'auth_sessions'],
  school: ['schools', 'school_classes', 'students', 'guardian_links', 'teacher_assignments'],
  content: ['posts', 'post_revisions', 'post_recipients', 'post_attachments', 'post_drafts', 'class_timetables', 'result_scores'],
  attendance: ['attendance_batches', 'attendance_events', 'attendance_current', 'absence_responses', 'parent_leave_applications'],
  files: ['file_objects', 'upload_sessions', 'file_access_events', 'scanner_provider_state', 'scanner_requests'],
  notifications: ['notifications', 'outbox_events', 'consumer_failures'], audit: ['audit_events', 'consumer_failures'],
  'read-model': ['consumed_events', 'read_posts', 'read_post_recipients', 'read_attendance', 'consumer_failures'],
  fees: ['fee_ledger_state', 'fee_invoices', 'fee_collections', 'fee_import_batches'],
};
export function managedEnvironment(input) {
  const environment = resolveServiceDatabases(input);
  environment.SERVICE_BIND_HOST = '127.0.0.1';
  internalPrefixes.forEach((prefix, index) => {
    const port = Number(environment[`${prefix}_PORT`] ?? 3101 + index);
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === Number(environment.PORT ?? 3000)) throw new Error(`${prefix}_PORT_INVALID`);
    environment[`${prefix}_PORT`] = String(port);
    const endpoint = `http://127.0.0.1:${port}`;
    if (environment[`${prefix}_SERVICE_URL`] && environment[`${prefix}_SERVICE_URL`] !== endpoint) throw new Error(`${prefix}_SERVICE_URL_MUST_MATCH_LOOPBACK_PORT`);
    environment[`${prefix}_SERVICE_URL`] = endpoint;
  });
  if (new Set(internalPrefixes.map((prefix) => environment[`${prefix}_PORT`])).size !== internalPrefixes.length) throw new Error('INTERNAL_PORTS_MUST_BE_DISTINCT');
  validateManagedRuntime(environment);
  return environment;
}
export async function requiredMigrationIds() {
  const ids = new Map(Object.values(serviceDatabases).map(([, database]) => [database, new Set()]));
  for (const file of MIGRATIONS) {
    const source = await readFile(new URL(`../infra/postgres/init/${file}`, import.meta.url), 'utf8');
    for (const segment of parseMigrationSegments(source, file)) ids.get(segment.databaseName).add(segment.migrationId);
  }
  return ids;
}
// No DDL, seed SQL or business writes: ordinary restarts only verify readiness.
export async function verifyManagedSchema(environment, Client = requireService('pg').Client) {
  const migrations = await requiredMigrationIds();
  for (const [service, [variable, database]] of Object.entries(serviceDatabases)) {
    const client = new Client({ connectionString: environment[variable], connectionTimeoutMillis: Number(environment.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(environment.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      const names = new Set(tables.rows.map((row) => row.tablename));
      for (const table of [...requiredTables[service], 'render_demo_migrations']) if (!names.has(table)) throw new Error(`SCHEMA_NOT_READY:${database}`);
      const recorded = await client.query('SELECT migration_id FROM render_demo_migrations');
      const applied = new Set(recorded.rows.map((row) => row.migration_id));
      if ([...migrations.get(database)].some((id) => !applied.has(id))) throw new Error(`MIGRATIONS_PENDING:${database}`);
      if (service === 'identity') {
        const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'");
        if (!columns.rows.some((row) => row.column_name === 'passcode_hash')) throw new Error(`SCHEMA_NOT_READY:${database}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof Error && /^(SCHEMA_NOT_READY|MIGRATIONS_PENDING):/.test(error.message)) throw error;
      throw new Error(`SCHEMA_CHECK_FAILED:${database}`);
    } finally { await client.end().catch(() => undefined); }
  }
}
export async function startManagedRuntime(input = process.env, { checkOnly = false } = {}) {
  const environment = managedEnvironment(input);
  await verifyManagedSchema(environment);
  console.log(JSON.stringify({ event: 'managed-runtime-validated', stage: environment.DEPLOYMENT_STAGE, mockOtp: environment.OTP_PROVIDER === 'development', attachmentsEnabled: environment.FILE_STORAGE_PROVIDER === 's3', outboxPollIntervalMs: Number(environment.OUTBOX_POLL_INTERVAL_MS ?? 2000) }));
  if (environment.OTP_PROVIDER === 'development') console.warn('TRIAL_ONLY: mock OTP permits account recovery without phone possession; never use real school data.');
  if (checkOnly) return;
  Object.assign(process.env, environment);
  for (const service of runtimeServices) await import(`../services/${service}/dist/main.js`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('MANAGED_RUNTIME_ARGUMENT_INVALID');
  startManagedRuntime(process.env, { checkOnly: process.argv.includes('--check') }).catch((error) => {
    console.error(error instanceof Error && /^(SCHEMA_|MIGRATIONS_|[A-Z_]+:|[A-Z_]+$)/.test(error.message) ? error.message : 'MANAGED_RUNTIME_START_FAILED');
    process.exitCode = 1;
  });
}
