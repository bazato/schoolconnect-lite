import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../services/files/package.json', import.meta.url));
const { parse } = require('dotenv');
const sdk = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const root = fileURLToPath(new URL('../', import.meta.url));
const payload = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateR2TestConfig(env) {
  const missing = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_ENDPOINT'].filter((key) => !env[key]?.trim());
  if (missing.length) return { ok: false, code: 'R2_TEST_CONFIGURATION_MISSING', missing };
  let endpoint;
  try { endpoint = new URL(env.S3_ENDPOINT); } catch { return { ok: false, code: 'R2_TEST_ENDPOINT_INVALID' }; }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !/^[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)) {
    return { ok: false, code: 'R2_TEST_ENDPOINT_NOT_CLOUDFLARE' };
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET)) return { ok: false, code: 'R2_TEST_BUCKET_INVALID' };
  if (env.S3_REGION && env.S3_REGION !== 'auto') return { ok: false, code: 'R2_TEST_REGION_MUST_BE_AUTO' };
  return { ok: true };
}

// Never return an exception message, request headers, credentials or presigned URLs.
export function safeR2TestError(error) {
  const name = error?.name;
  const allowed = ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket', 'NoSuchKey', 'NotFound', 'AbortError', 'TimeoutError'];
  return { code: allowed.includes(name) ? name : 'R2_TEST_OPERATION_FAILED', ...(Number.isInteger(error?.$metadata?.httpStatusCode) ? { httpStatus: error.$metadata.httpStatusCode } : {}) };
}

export async function runR2SmokeTest(env, { send, sign, http, uuid = randomUUID, record = () => {} }) {
  const valid = validateR2TestConfig(env);
  if (!valid.ok) return valid;
  const id = uuid();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('R2_TEST_ID_INVALID');
  const prefix = `__nexqon_r2_smoke__/${id}/`;
  const quarantine = `${prefix}quarantine.png`;
  const ready = `${prefix}private.png`;
  const attempted = new Set();
  const checks = [];
  let activeCheck = 'presigned_upload';
  let failure;
  let cleanupFailed = false;
  const pass = (check) => { checks.push(check); record({ check, status: 'passed' }); };
  const command = (Constructor, input) => send(new Constructor({ Bucket: env.S3_BUCKET, ...input }));
  try {
    const headers = { 'content-type': 'image/png', 'x-amz-meta-checksumsha256': digest(payload) };
    const upload = await sign(new sdk.PutObjectCommand({ Bucket: env.S3_BUCKET, Key: quarantine, ContentType: 'image/png', ContentLength: payload.length, Metadata: { checksumsha256: digest(payload) } }));
    attempted.add(quarantine);
    const put = await http(upload, { method: 'PUT', headers, body: payload });
    if (!put.ok) throw { name: 'UploadRejected', $metadata: { httpStatusCode: put.status } };
    pass(activeCheck);

    activeCheck = 'uploaded_size';
    const head = await command(sdk.HeadObjectCommand, { Key: quarantine });
    if (head.ContentLength !== payload.length) throw new Error('SIZE_MISMATCH');
    pass(activeCheck);

    activeCheck = 'uploaded_bytes';
    const object = await command(sdk.GetObjectCommand, { Key: quarantine });
    if (digest(await object.Body.transformToByteArray()) !== digest(payload)) throw new Error('CHECKSUM_MISMATCH');
    pass(activeCheck);

    activeCheck = 'private_promotion';
    attempted.add(ready);
    await command(sdk.CopyObjectCommand, { Key: ready, CopySource: `${env.S3_BUCKET}/${quarantine}`, MetadataDirective: 'COPY' });
    pass(activeCheck);

    activeCheck = 'signed_download';
    const url = await sign(new sdk.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: ready, ResponseCacheControl: 'private, no-store' }));
    const download = await http(url, { method: 'GET' });
    if (!download.ok || digest(Buffer.from(await download.arrayBuffer())) !== digest(payload)) throw new Error('DOWNLOAD_REJECTED_OR_CORRUPT');
    pass(activeCheck);

    activeCheck = 'unsigned_s3_access_denied';
    const anonymous = await http(`${env.S3_ENDPOINT.replace(/\/$/, '')}/${env.S3_BUCKET}/${ready}`, { method: 'GET' });
    // R2 can reject unsigned S3 API requests with HTTP 400, not only 403.
    if (![400, 401, 403, 404].includes(anonymous.status)) throw new Error('UNSIGNED_ACCESS_NOT_DENIED');
    await anonymous.body?.cancel();
    pass(activeCheck);
  } catch (error) {
    failure = { check: activeCheck, ...safeR2TestError(error) };
    record({ ...failure, status: 'failed' });
  } finally {
    // Only the two exact keys from this test's fresh random namespace may be deleted.
    for (const key of attempted) {
      try { await command(sdk.DeleteObjectCommand, { Key: key }); }
      catch (error) { cleanupFailed = true; record({ check: 'cleanup', status: 'failed', ...safeR2TestError(error) }); }
    }
    if (attempted.size && !cleanupFailed) pass('cleanup');
  }
  return { ok: !failure && !cleanupFailed, checks, ...(failure ? { failure } : {}), cleanup: cleanupFailed ? 'failed' : 'complete', ...(cleanupFailed ? { cleanupPrefix: prefix } : {}) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--run', '--check'].includes(arg)) || (args.includes('--run') && args.includes('--check'))) {
    console.error('Use --check (no network) or --run (tiny synthetic upload/download, followed by cleanup).');
    process.exitCode = 1;
    return;
  }
  const path = resolve(root, '.env.r2-test');
  const env = { ...process.env, ...(existsSync(path) ? parse(readFileSync(path)) : {}) };
  const valid = validateR2TestConfig(env);
  if (!valid.ok || !args.includes('--run')) {
    console.log(JSON.stringify({ ...valid, mode: 'configuration-only', networkRequests: 0 }));
    if (!valid.ok) process.exitCode = 1;
    return;
  }
  const client = new sdk.S3Client({
    region: 'auto', endpoint: env.S3_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    maxAttempts: 2, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  try {
    const result = await runR2SmokeTest(env, {
      send: (command) => client.send(command, { abortSignal: AbortSignal.timeout(15000) }),
      sign: (command) => getSignedUrl(client, command, { expiresIn: 60 }),
      http: (url, options) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }),
      record: (result) => console.log(JSON.stringify(result)),
    });
    console.log(JSON.stringify({ ...result, scope: 'R2 storage only; not application authorization, malware scanning or browser CORS' }));
    if (!result.ok) process.exitCode = 1;
  } finally { client.destroy(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(JSON.stringify(safeR2TestError(error))); process.exitCode = 1; });
}
