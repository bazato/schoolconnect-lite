import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('infra/postgres/init');
const migrations = readdirSync(directory)
  .filter((name) => /^\d{3}.*\.sql$/.test(name) && Number(name.slice(0, 3)) >= 95)
  .sort();

const exists = execFileSync('docker', ['exec', 'schoolconnect-postgres', 'psql', '-U', process.env.POSTGRES_USER ?? 'schoolconnect', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='schoolconnect_read'"], { encoding: 'utf8' }).trim();
if (!exists) execFileSync('docker', ['exec', 'schoolconnect-postgres', 'psql', '-U', process.env.POSTGRES_USER ?? 'schoolconnect', '-d', 'postgres', '-c', 'CREATE DATABASE schoolconnect_read'], { stdio: 'inherit' });

for (const migration of migrations) {
  execFileSync('docker', [
    'exec', '-i', 'schoolconnect-postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', process.env.POSTGRES_USER ?? 'schoolconnect', '-d', 'postgres',
  ], { input: await import('node:fs').then(({ readFileSync }) => readFileSync(resolve(directory, migration))), stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`Applied ${migration}`);
}
