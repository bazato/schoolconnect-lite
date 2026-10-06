import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { databaseUrl, DEMO_DATABASES, parseMigrationSegments } from './render-demo-db.mjs';

test('one Render Postgres instance still uses distinct logical service databases', () => {
  const base = 'postgresql://demo:secret@postgres.internal/schoolconnect_demo?sslmode=require';
  const urls = DEMO_DATABASES.map((name) => databaseUrl(base, name));
  assert.equal(new Set(urls).size, 7);
  assert.equal(new URL(urls[0]).pathname, '/schoolconnect_identity');
  assert.equal(new URL(urls[0]).searchParams.get('sslmode'), 'require');
  assert.throws(() => databaseUrl(base, 'postgres'));
});

test('every bundled migration targets only a known service database', async () => {
  const files = [
    '010-identity.sql', '020-school.sql', '030-content.sql', '040-attendance.sql',
    '050-files.sql', '060-notifications.sql', '070-audit.sql', '080-admin-provisioning.sql',
    '095-security-and-scale.sql', '096-product-workflows.sql',
    '097-publishing-permissions.sql', '098-observability.sql',
    '099-notification-lifecycle.sql', '090-development-seed.sql',
  ];
  for (const fileName of files) {
    const source = await readFile(new URL(`../infra/postgres/init/${fileName}`, import.meta.url), 'utf8');
    const segments = parseMigrationSegments(source, fileName);
    assert.ok(segments.length > 0, fileName);
    assert.ok(segments.every((segment) => DEMO_DATABASES.includes(segment.databaseName)));
    assert.equal(new Set(segments.map((segment) => segment.migrationId)).size, segments.length);
  }
});

test('an unapproved database or psql command cannot enter the demo migrator', () => {
  assert.throws(() => parseMigrationSegments('\\connect postgres\nDROP TABLE users;', 'bad.sql'));
  assert.throws(() => parseMigrationSegments('\\connect schoolconnect_identity\n\\include other.sql', 'bad.sql'));
});
