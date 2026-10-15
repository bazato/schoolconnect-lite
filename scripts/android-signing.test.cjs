const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchReleaseSigning } = require('../apps/mobile/plugins/with-release-signing.cjs');

test('release debug fallback is overridden; debug builds remain available', () => {
  const original = 'android { buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig signingConfigs.debug } } }';
  const result = patchReleaseSigning(original);
  assert.ok(result.startsWith(original));
  assert.ok(result.includes('android.buildTypes.release.signingConfig = null'));
  assert.ok(result.includes('android.signingConfigs.nexqonRelease'));
  assert.ok(result.includes('debug fallback is forbidden'));
});
test('prebuild signing patch is idempotent', () => {
  const once = patchReleaseSigning('android {}');
  assert.equal(patchReleaseSigning(once), once);
});
test('release requires HTTPS and disables client demo mode', () => {
  const result = patchReleaseSigning('android {}');
  assert.ok(result.includes("api.startsWith('https://')"));
  assert.ok(result.includes("System.getenv('EXPO_PUBLIC_DEMO_MODE') != 'false'"));
});
test('native file contains environment references, never resolved secrets', () => {
  process.env.NEXQON_ANDROID_STORE_PASSWORD = 'test-sentinel-not-a-real-password';
  try {
    const result = patchReleaseSigning('android {}');
    assert.ok(result.includes("System.getenv('NEXQON_ANDROID_STORE_PASSWORD')"));
    assert.ok(!result.includes(process.env.NEXQON_ANDROID_STORE_PASSWORD));
  } finally { delete process.env.NEXQON_ANDROID_STORE_PASSWORD; }
});
test('incomplete previous patch fails instead of producing unsafe configuration', () => {
  assert.throws(() => patchReleaseSigning('// nexqon-release-signing:start'), /Incomplete/);
});
