import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runR2SmokeTest, safeR2TestError, validateR2TestConfig } from './r2-smoke-test.mjs';

const env = { S3_ACCESS_KEY_ID: 'fixture-id', S3_SECRET_ACCESS_KEY: 'fixture-secret', S3_BUCKET: 'test-bucket', S3_ENDPOINT: 'https://00000000000000000000000000000000.r2.cloudflarestorage.com', S3_REGION: 'auto' };
const id = '00000000-0000-4000-8000-000000000001';

test('missing credentials fail before any network or storage operations', async () => {
  const result = await runR2SmokeTest({}, { send: () => assert.fail(), sign: () => assert.fail(), http: () => assert.fail() });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('S3_SECRET_ACCESS_KEY'));
});

test('configuration accepts only a Cloudflare HTTPS S3 endpoint and safe bucket', () => {
  assert.equal(validateR2TestConfig(env).ok, true);
  for (const endpoint of ['http://00000000000000000000000000000000.r2.cloudflarestorage.com', 'https://evil.example', `${env.S3_ENDPOINT}/credentials`, `${env.S3_ENDPOINT}?key=secret`, 'https://user:password@00000000000000000000000000000000.r2.cloudflarestorage.com']) {
    assert.equal(validateR2TestConfig({ ...env, S3_ENDPOINT: endpoint }).ok, false);
  }
  assert.equal(validateR2TestConfig({ ...env, S3_BUCKET: '../other' }).ok, false);
  assert.equal(validateR2TestConfig({ ...env, S3_REGION: 'us-east-1' }).ok, false);
});

test('error output never includes raw errors, signed URLs or credentials', () => {
  assert.deepEqual(safeR2TestError({ name: 'fixture-secret', message: 'https://signed-secret.example', $metadata: { httpStatusCode: 403 } }), { code: 'R2_TEST_OPERATION_FAILED', httpStatus: 403 });
  assert.deepEqual(safeR2TestError({ name: 'AccessDenied', message: 'fixture-secret' }), { code: 'AccessDenied' });
});

function fixture({ anonymousStatus = 403, failCopy = false, failDelete = false, corruptDownload = false } = {}) {
  let bytes;
  const commands = [];
  const records = [];
  return { commands, records, options: {
    uuid: () => id,
    record: (result) => records.push(result),
    sign: async (command) => command.constructor.name === 'PutObjectCommand' ? 'https://signed.example/upload' : 'https://signed.example/download',
    http: async (url, options) => {
      if (url.endsWith('/upload')) { bytes = options.body; return { ok: true }; }
      if (url.endsWith('/download')) return { ok: true, arrayBuffer: async () => corruptDownload ? Buffer.from('bad') : bytes };
      return { status: anonymousStatus };
    },
    send: async (command) => {
      commands.push(command);
      switch (command.constructor.name) {
        case 'HeadObjectCommand': return { ContentLength: bytes.length };
        case 'GetObjectCommand': return { Body: { transformToByteArray: async () => bytes } };
        case 'CopyObjectCommand': if (failCopy) throw { name: 'AccessDenied' }; return {};
        case 'DeleteObjectCommand': if (failDelete) throw { name: 'AccessDenied' }; return {};
        default: assert.fail('Unexpected storage operation');
      }
    },
  } };
}

test('successful storage test compares bytes and deletes only its own two exact keys', async () => {
  const f = fixture();
  const result = await runR2SmokeTest(env, f.options);
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 7);
  const deleted = f.commands.filter((c) => c.constructor.name === 'DeleteObjectCommand');
  assert.deepEqual(deleted.map((c) => c.input.Key), [`__nexqon_r2_smoke__/${id}/quarantine.png`, `__nexqon_r2_smoke__/${id}/private.png`]);
  assert.ok(f.commands.every((c) => c.input.Bucket === 'test-bucket'));
});

test('copy failure still attempts cleanup without passing the storage test', async () => {
  const f = fixture({ failCopy: true });
  const result = await runR2SmokeTest(env, f.options);
  assert.equal(result.ok, false);
  assert.equal(result.failure.check, 'private_promotion');
  assert.equal(f.commands.filter((c) => c.constructor.name === 'DeleteObjectCommand').length, 2);
});

test('publicly accessible S3 test object fails the unsigned-access check', async () => {
  const f = fixture({ anonymousStatus: 200 });
  const result = await runR2SmokeTest(env, f.options);
  assert.equal(result.ok, false);
  assert.equal(result.failure.check, 'unsigned_s3_access_denied');
});

test('corrupt signed downloads fail and are cleaned up', async () => {
  const f = fixture({ corruptDownload: true });
  const result = await runR2SmokeTest(env, f.options);
  assert.equal(result.ok, false);
  assert.equal(result.failure.check, 'signed_download');
  assert.equal(result.cleanup, 'complete');
});

test('cleanup failures are visible, keep a cleanup prefix, and fail the test', async () => {
  const f = fixture({ failDelete: true });
  const result = await runR2SmokeTest(env, f.options);
  assert.equal(result.ok, false);
  assert.equal(result.cleanup, 'failed');
  assert.equal(result.cleanupPrefix, `__nexqon_r2_smoke__/${id}/`);
});
