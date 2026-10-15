import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { managedEnvironment, verifyManagedSchema, requiredMigrationIds, requiredTables } from './managed-runtime.mjs';
import { migrateManaged, migrationPlan } from './migrate-managed.mjs';
const requireService = createRequire(new URL('../services/identity/package.json', import.meta.url));
const { serviceDatabases } = requireService('@schoolconnect/contracts');
function environment() {
  return { NODE_ENV:'production', DEPLOYMENT_STAGE:'trial', ALLOW_MOCK_OTP:'true',
    DATABASE_URL:'postgres://fixture:fixture@database.test/base?sslmode=verify-full',
    AUTH_JWT_SECRET:'a'.repeat(40), INTERNAL_SERVICE_TOKEN:'b'.repeat(40), AUTHORIZATION_PROVIDER:'local-jwt', RESOURCE_AUTHORIZATION_PROVIDER:'policy',
    AUTH_JWT_ISSUER:'existing-issuer', AUTH_JWT_AUDIENCE:'existing-audience', OTP_PROVIDER:'development', DEVELOPMENT_OTP_CODE:'123456',
    CORS_ALLOWED_ORIGINS:'https://school.example', ENFORCE_HTTPS:'true', KAFKA_BROKERS:'broker.test:9093', KAFKA_SSL:'true',
    KAFKA_SASL_MECHANISM:'scram-sha-256', KAFKA_SASL_USERNAME:'fixture', KAFKA_SASL_PASSWORD:'fixture', KAFKA_EVENT_TOPIC:'fixture-events',
    KAFKA_CREATE_TOPIC:'false', OUTBOX_POLL_INTERVAL_MS:'2000', FILE_STORAGE_PROVIDER:'disabled' };
}
test('managed configuration preserves secrets and polling, uses nine DBs and loopback internal services', () => {
  const original = environment(); const prepared = managedEnvironment(original);
  assert.equal(prepared.INTERNAL_SERVICE_TOKEN, original.INTERNAL_SERVICE_TOKEN);
  assert.equal(prepared.AUTH_JWT_SECRET, original.AUTH_JWT_SECRET);
  assert.equal(prepared.OUTBOX_POLL_INTERVAL_MS, '2000');
  assert.equal(prepared.SERVICE_BIND_HOST, '127.0.0.1');
  assert.equal(prepared.FILE_SERVICE_URL, 'http://127.0.0.1:3105');
  assert.equal(prepared.FEES_PORT, '3110');
  assert.equal(Object.keys(original).length, Object.keys(environment()).length);
  assert.equal(new Set(Object.values(serviceDatabases).map(([variable]) => new URL(prepared[variable]).pathname)).size, 9);
});
test('invalid/colliding internal ports and remote URLs cannot expose the bundled services', () => {
  assert.throws(() => managedEnvironment({ ...environment(), IDENTITY_PORT:'3000' }), /PORT_INVALID/);
  assert.throws(() => managedEnvironment({ ...environment(), CONTENT_PORT:'3101' }), /PORTS_MUST_BE_DISTINCT/);
  assert.throws(() => managedEnvironment({ ...environment(), SCHOOL_SERVICE_URL:'http://public.example' }), /LOOPBACK/);
});
test('schema gate reads all nine DBs without DDL, seeding or application writes', async () => {
  const ids = await requiredMigrationIds(); const queries = []; const connections = [];
  class FixtureClient {
    constructor(options) { this.database = new URL(options.connectionString).pathname.slice(1); connections.push(this.database); }
    async connect() {} async end() {}
    async query(sql) {
      queries.push(sql);
      if (sql.includes('pg_tables')) {
        const service = Object.entries(serviceDatabases).find(([, [, database]]) => database === this.database)[0];
        return { rows:[...requiredTables[service], 'render_demo_migrations'].map((tablename) => ({ tablename })) };
      }
      if (sql.includes('SELECT migration_id')) return { rows:[...ids.get(this.database)].map((migration_id) => ({ migration_id })) };
      if (sql.includes('information_schema.columns')) return { rows:[{ column_name:'passcode_hash' }] };
      return { rows:[] };
    }
  }
  await verifyManagedSchema(managedEnvironment(environment()), FixtureClient);
  assert.equal(new Set(connections).size, 9);
  assert.equal(queries.filter((sql) => sql === 'BEGIN READ ONLY').length, 9);
  assert.ok(queries.every((sql) => /^(SELECT|BEGIN READ ONLY|COMMIT|ROLLBACK)/.test(sql)));
});
test('missing schema or migrations fail closed before services start', async () => {
  let closed = false;
  class MissingClient { async connect() {} async end() { closed = true; } async query() { return { rows:[] }; } }
  await assert.rejects(verifyManagedSchema(managedEnvironment(environment()), MissingClient), /SCHEMA_NOT_READY:schoolconnect_identity/);
  assert.ok(closed);
  class PendingClient extends MissingClient {
    async query(sql) { return { rows:sql.includes('pg_tables') ? [...requiredTables.identity, 'render_demo_migrations'].map((tablename) => ({ tablename })) : [] }; }
  }
  await assert.rejects(verifyManagedSchema(managedEnvironment(environment()), PendingClient), /MIGRATIONS_PENDING/);
});
test('database errors are redacted and the connection is closed', async () => {
  let closed = false;
  class FailedClient { async connect() { throw new Error('private-password@host'); } async end() { closed = true; } async query() {} }
  await assert.rejects(verifyManagedSchema(managedEnvironment(environment()), FailedClient), /^Error: SCHEMA_CHECK_FAILED:schoolconnect_identity$/);
  assert.ok(closed);
});
test('migration planning needs no connection and never includes development seed SQL', async () => {
  class ForbiddenClient { constructor() { throw new Error('must not connect during plan'); } }
  const plan = await migrateManaged({}, false, ForbiddenClient);
  assert.equal(new Set(plan.map((segment) => segment.databaseName)).size, 9);
  assert.ok(plan.some((segment) => segment.migrationId.startsWith('103-passcode-auth.sql')));
  assert.ok(plan.every((segment) => !segment.migrationId.includes('seed')));
  assert.ok((await migrationPlan()).every((segment) => !segment.sql.includes('OWNER-INVITE')));
});
test('migration apply requires a separate verified direct admin connection', async () => {
  await assert.rejects(migrateManaged({}, true), /MIGRATION_DATABASE_URL/);
  await assert.rejects(migrateManaged({ MIGRATION_DATABASE_URL:'postgres://fixture:fixture@db-pooler.test/root?sslmode=verify-full' }, true), /DIRECT_MIGRATION_CONNECTION_REQUIRED/);
});
