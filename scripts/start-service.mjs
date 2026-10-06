import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const allowed = new Set(['api', 'identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit', 'authorization', 'read-model']);
const service = process.env.SERVICE_NAME ?? 'api';
if (!allowed.has(service)) throw new Error('SERVICE_NAME_INVALID');
const child = spawn(process.execPath, [fileURLToPath(new URL(`../services/${service}/dist/main.js`, import.meta.url))], { stdio: 'inherit', env: process.env });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
