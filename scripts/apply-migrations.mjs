import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('infra/postgres/init');
const migrations = readdirSync(directory)
  .filter((name) => /^09[5-9].*\.sql$/.test(name))
  .sort();

for (const migration of migrations) {
  execFileSync('docker', [
    'exec', '-i', 'schoolconnect-postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', process.env.POSTGRES_USER ?? 'schoolconnect', '-d', 'postgres',
  ], { input: await import('node:fs').then(({ readFileSync }) => readFileSync(resolve(directory, migration))), stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`Applied ${migration}`);
}
