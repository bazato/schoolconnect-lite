import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const requireIdentityDependency = createRequire(new URL('../services/identity/package.json', import.meta.url));

export const DEMO_DATABASES = [
  'schoolconnect_identity', 'schoolconnect_school', 'schoolconnect_content',
  'schoolconnect_attendance', 'schoolconnect_files',
  'schoolconnect_notifications', 'schoolconnect_audit',
];

const SERVICE_DATABASES = {
  IDENTITY_DATABASE_URL: 'schoolconnect_identity',
  SCHOOL_DATABASE_URL: 'schoolconnect_school',
  CONTENT_DATABASE_URL: 'schoolconnect_content',
  ATTENDANCE_DATABASE_URL: 'schoolconnect_attendance',
  FILE_DATABASE_URL: 'schoolconnect_files',
  NOTIFICATION_DATABASE_URL: 'schoolconnect_notifications',
  AUDIT_DATABASE_URL: 'schoolconnect_audit',
};

const MIGRATIONS = [
  '010-identity.sql', '020-school.sql', '030-content.sql',
  '040-attendance.sql', '050-files.sql', '060-notifications.sql',
  '070-audit.sql', '080-admin-provisioning.sql',
  '095-security-and-scale.sql', '096-product-workflows.sql',
  '097-publishing-permissions.sql',
];

export function databaseUrl(baseUrl, databaseName) {
  if (!DEMO_DATABASES.includes(databaseName)) throw new Error('RENDER_DEMO_DATABASE_INVALID');
  const url = new URL(baseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('RENDER_DEMO_DATABASE_URL_INVALID');
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function parseMigrationSegments(source, fileName) {
  const segments = [];
  let databaseName = null;
  let lines = [];
  const flush = () => {
    if (databaseName && lines.join('').trim()) {
      segments.push({ databaseName, migrationId: `${fileName}#${segments.length + 1}`, sql: lines.join('\n') });
    }
    lines = [];
  };
  for (const line of source.split(/\r?\n/)) {
    const match = /^\\connect\s+(schoolconnect_[a-z]+)\s*$/.exec(line);
    if (match) {
      flush();
      if (!DEMO_DATABASES.includes(match[1])) throw new Error(`RENDER_DEMO_MIGRATION_TARGET_INVALID:${fileName}`);
      databaseName = match[1];
    } else if (databaseName) {
      if (line.startsWith('\\')) throw new Error(`RENDER_DEMO_MIGRATION_META_COMMAND_UNSUPPORTED:${fileName}`);
      lines.push(line);
    } else if (line.trim() && !line.trim().startsWith('--')) {
      throw new Error(`RENDER_DEMO_MIGRATION_MISSING_TARGET:${fileName}`);
    }
  }
  flush();
  if (!segments.length) throw new Error(`RENDER_DEMO_MIGRATION_EMPTY:${fileName}`);
  return segments;
}

async function applySegment(Client, baseUrl, segment) {
  const client = new Client({ connectionString: databaseUrl(baseUrl, segment.databaseName), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS render_demo_migrations (
      migration_id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query('SELECT 1 FROM render_demo_migrations WHERE migration_id=$1', [segment.migrationId]);
    if (!applied.rowCount) {
      await client.query(segment.sql);
      await client.query('INSERT INTO render_demo_migrations (migration_id) VALUES ($1)', [segment.migrationId]);
      console.log('Applied', segment.migrationId, 'to', segment.databaseName);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function prepareRenderDemoDatabase(baseUrl, seedDemo = true) {
  const { Client } = requireIdentityDependency('pg');
  const admin = new Client({ connectionString: baseUrl, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    await admin.query('SELECT pg_advisory_lock(5213366)');
    for (const databaseName of DEMO_DATABASES) {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
      if (!exists.rowCount) await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
    for (const fileName of [...MIGRATIONS, ...(seedDemo ? ['090-development-seed.sql'] : [])]) {
      const source = await readFile(new URL(`../infra/postgres/init/${fileName}`, import.meta.url), 'utf8');
      for (const segment of parseMigrationSegments(source, fileName)) await applySegment(Client, baseUrl, segment);
    }
  } finally {
    await admin.query('SELECT pg_advisory_unlock(5213366)').catch(() => undefined);
    await admin.end();
  }
  for (const [variable, databaseName] of Object.entries(SERVICE_DATABASES)) {
    process.env[variable] = databaseUrl(baseUrl, databaseName);
  }
}
