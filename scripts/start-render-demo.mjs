// A disposable free-tier trial: one process hosts the existing service modules.
// Production continues to use one process/container per service.
import { prepareRenderDemoDatabase } from './render-demo-db.mjs';

if (process.env.RENDER_DEMO_MODE !== 'true') throw new Error('RENDER_DEMO_MODE_REQUIRED');
if (process.env.NODE_ENV !== 'development') throw new Error('RENDER_DEMO_REQUIRES_DEVELOPMENT_MODE');
if (!process.env.DATABASE_URL) throw new Error('RENDER_DEMO_DATABASE_URL_REQUIRED');
if ((process.env.AUTH_JWT_SECRET?.length ?? 0) < 32) throw new Error('RENDER_DEMO_AUTH_SECRET_REQUIRED');
if ((process.env.INTERNAL_SERVICE_TOKEN?.length ?? 0) < 32) throw new Error('RENDER_DEMO_INTERNAL_TOKEN_REQUIRED');
if (process.env.OTP_PROVIDER !== 'development') throw new Error('RENDER_DEMO_MOCK_OTP_REQUIRED');

process.env.SERVICE_BIND_HOST = '127.0.0.1';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9'; // No private object store in the free trial.
await prepareRenderDemoDatabase(process.env.DATABASE_URL, true);

for (const service of ['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit', 'api', 'workers']) {
  await import(`../services/${service}/dist/main.js`);
}
