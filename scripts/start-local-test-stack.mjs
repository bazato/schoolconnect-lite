// Runs the actual services against Docker PostgreSQL/Kafka on separate local ports.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const services = ['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit', 'authorization', 'read-model'];
const prefixes = ['IDENTITY', 'SCHOOL', 'CONTENT', 'ATTENDANCE', 'FILE', 'NOTIFICATION', 'AUDIT', 'AUTHORIZATION', 'READ'];
const env = { ...process.env, NODE_ENV: 'development', AUTH_JWT_SECRET: randomBytes(32).toString('hex'), INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  OTP_PROVIDER: 'development', DEVELOPMENT_OTP_CODE: '123456', OTP_REQUEST_LIMIT: '100', OTP_REQUEST_WINDOW_SECONDS: '60', KAFKA_BROKERS: '127.0.0.1:9092', KAFKA_CREATE_TOPIC: 'true',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081,http://127.0.0.1:8081', API_AUTH_RATE_LIMIT: '1000', API_USER_RATE_LIMIT: '1000', SERVICE_BIND_HOST: '127.0.0.1' };
prefixes.forEach((prefix, i) => { env[`${prefix}_SERVICE_URL`] = `http://127.0.0.1:${3201 + i}`; env[`${prefix}_PORT`] = String(3201 + i); });
const children = [...services, 'api'].map((name) => spawn(process.execPath, [`services/${name}/dist/main.js`], { stdio: 'inherit', env: { ...env, PORT: '3010' } }));
for (const child of children) child.on('error', (error) => { console.error(error.message); children.forEach((other) => other.kill()); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { children.forEach((child) => child.kill()); });
console.log('Local regression API: http://127.0.0.1:3010/api/v1');
