import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MIGRATIONS, DEMO_DATABASES, applySegment, parseMigrationSegments } from './render-demo-db.mjs';
const requireService = createRequire(new URL('../services/identity/package.json', import.meta.url));
export async function migrationPlan() {
  const segments = [];
  for (const file of MIGRATIONS) segments.push(...parseMigrationSegments(await readFile(new URL(`../infra/postgres/init/${file}`, import.meta.url), 'utf8'), file));
  return segments;
}
export async function migrateManaged(environment = process.env, apply = false, Client = requireService('pg').Client) {
  const segments = await migrationPlan();
  if (!apply) return segments.map(({ databaseName, migrationId }) => ({ databaseName, migrationId }));
  const { validateDatabaseUrl } = requireService('@schoolconnect/contracts');
  const url = validateDatabaseUrl(environment.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL');
  if (url.hostname.includes('-pooler')) throw new Error('DIRECT_MIGRATION_CONNECTION_REQUIRED');
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('VERIFIED_DATABASE_TLS_REQUIRED');
  const admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
  await admin.connect();
  try {
    await admin.query('SELECT pg_advisory_lock(5213366)');
    const result = await admin.query('SELECT datname FROM pg_database');
    const existing = new Set(result.rows.map((row) => row.datname));
    if (DEMO_DATABASES.some((name) => !existing.has(name))) throw new Error('SERVICE_DATABASES_MUST_BE_PROVISIONED_SEPARATELY');
    for (const segment of segments) await applySegment(Client, url.toString(), segment);
  } finally {
    await admin.query('SELECT pg_advisory_unlock(5213366)').catch(() => undefined);
    await admin.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--plan', '--apply'].includes(args[0])) throw new Error('USE_EXPLICIT_MIGRATION_PLAN_OR_APPLY');
  migrateManaged(process.env, args[0] === '--apply').then((plan) => {
    if (plan) console.log(JSON.stringify(plan, null, 2));
    else console.log('MANAGED_MIGRATIONS_COMPLETE');
  }).catch(() => { console.error('MANAGED_MIGRATION_FAILED: inspect credentials, permissions and release migrations privately.'); process.exitCode = 1; });
}
