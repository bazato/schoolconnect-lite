// Runs the actual services against Docker PostgreSQL/Kafka on separate local ports.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const services = ['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit', 'authorization', 'read-model', 'fees'];
const prefixes = ['IDENTITY', 'SCHOOL', 'CONTENT', 'ATTENDANCE', 'FILE', 'NOTIFICATION', 'AUDIT', 'AUTHORIZATION', 'READ', 'FEES'];
const isolated = process.argv.includes('--release-isolated');
const firstPort = isolated ? 3401 : 3201;
const apiPort = isolated ? 3390 : 3010;
const env = { ...process.env, NODE_ENV: 'development', AUTH_JWT_SECRET: randomBytes(32).toString('hex'), INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  PASSCODE_PEPPER: 'schoolconnect-synthetic-local-regression-pepper-only',
  OTP_PROVIDER: 'development', DEVELOPMENT_OTP_CODE: '123456', OTP_REQUEST_LIMIT: '100', OTP_REQUEST_WINDOW_SECONDS: '60', KAFKA_BROKERS: '127.0.0.1:9092', KAFKA_CREATE_TOPIC: 'true',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081,http://127.0.0.1:8081', API_AUTH_RATE_LIMIT: '1000', API_USER_RATE_LIMIT: '1000', SERVICE_BIND_HOST: '127.0.0.1' };
prefixes.forEach((prefix, i) => { env[`${prefix}_SERVICE_URL`] = `http://127.0.0.1:${firstPort + i}`; env[`${prefix}_PORT`] = String(firstPort + i); });
if (isolated) {
  const databases = { IDENTITY:'identity', SCHOOL:'school', CONTENT:'content', ATTENDANCE:'attendance', FILE:'files', NOTIFICATION:'notifications', AUDIT:'audit', READ:'read', FEES:'fees' };
  for (const [prefix, name] of Object.entries(databases)) env[`${prefix}_DATABASE_URL`] = `postgresql://schoolconnect:schoolconnect-release-test-only@127.0.0.1:55432/schoolconnect_${name}`;
  env.KAFKA_BROKERS = '127.0.0.1:19092';
  env.KAFKA_SSL = 'false';
  env.KAFKA_SASL_MECHANISM = '';
  env.KAFKA_SASL_USERNAME = '';
  env.KAFKA_SASL_PASSWORD = '';
  env.KAFKA_EVENT_TOPIC = 'nexqon-release-acceptance';
  env.FILE_STORAGE_PROVIDER = 'disabled';
  env.FILE_SCANNER_PROVIDER = 'disabled';
  env.ENFORCE_HTTPS = 'false';
}
const children = [...services, 'api'].map((name) => spawn(process.execPath, [`services/${name}/dist/main.js`], { stdio: 'inherit', env: { ...env, PORT: String(apiPort) } }));
for (const child of children) child.on('error', (error) => { console.error(error.message); children.forEach((other) => other.kill()); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { children.forEach((child) => child.kill()); });
console.log(`Local regression API: http://127.0.0.1:${apiPort}/api/v1${isolated ? ' (isolated release databases/broker; attachments disabled)' : ''}`);
