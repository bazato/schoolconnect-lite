import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { managedCutoverEnvironment } from './render-cutover.mjs';

test('cutover preserves credentials, custom JWT identity, effective pepper and Kafka settings', () => {
  const input = { NODE_ENV:'development', RENDER_DEMO_MODE:'true', SC_DEMO_SEED:'true', AUTH_JWT_SECRET:'fixture-jwt', INTERNAL_SERVICE_TOKEN:'fixture-internal', PASSCODE_PEPPER:'fixture-pepper', AUTH_JWT_ISSUER:'custom-issuer', AUTH_JWT_AUDIENCE:'custom-audience', KAFKA_EVENT_TOPIC:'original-topic', OUTBOX_POLL_INTERVAL_MS:'2000', DATABASE_URL:'postgresql://fixture:fixture-password@database.test/base?sslmode=require' };
  const result=managedCutoverEnvironment(input);
  for (const k of ['AUTH_JWT_SECRET','INTERNAL_SERVICE_TOKEN','PASSCODE_PEPPER','AUTH_JWT_ISSUER','AUTH_JWT_AUDIENCE','KAFKA_EVENT_TOPIC','OUTBOX_POLL_INTERVAL_MS']) assert.equal(result[k],input[k]);
  assert.equal(result.NODE_ENV,'production');assert.equal(result.RENDER_DEMO_MODE,'false');assert.equal(result.SC_DEMO_SEED,'false');
  assert.equal(new URL(result.DATABASE_URL).searchParams.get('sslmode'),'verify-full');
  assert.equal(input.NODE_ENV,'development');
});
test('cutover retains legacy issuer/audience defaults and does not invent a pepper', () => {
  const result=managedCutoverEnvironment({});
  assert.equal(result.AUTH_JWT_ISSUER,'schoolconnect-identity-local');
  assert.equal(result.AUTH_JWT_AUDIENCE,'schoolconnect-mobile-local');
  assert.equal(result.PASSCODE_PEPPER,undefined);
});
test('all explicit service URLs get certificate-verifying TLS without changing database or host', () => {
  const input={DATABASE_URL:'postgresql://u:p@one.test/base?sslmode=require',CONTENT_DATABASE_URL:'postgresql://c:p@two.test/schoolconnect_content?sslmode=require'};
  const result=managedCutoverEnvironment(input);
  for (const k of Object.keys(input)) {
    assert.equal(new URL(result[k]).hostname,new URL(input[k]).hostname);
    assert.equal(new URL(result[k]).pathname,new URL(input[k]).pathname);
    assert.equal(new URL(result[k]).password,new URL(input[k]).password);
    assert.equal(new URL(result[k]).searchParams.get('sslmode'),'verify-full');
  }
});
test('cutover refuses disabled TLS and unsupported database protocols', () => {
  for(const url of ['http://database.test/base','postgres://u:p@database.test/base?ssl=false','postgres://u:p@database.test/base?uselibpqcompat=true']) assert.throws(()=>managedCutoverEnvironment({DATABASE_URL:url}));
});
test('managed selection exits through the read-only schema gate before legacy bootstrap', () => {
  const source=readFileSync(new URL('./start-render-demo.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf("SC_RUNTIME_MODE === 'managed'") < source.indexOf('prepareRenderDemoDatabase(process.env.DATABASE_URL'));
  assert.match(source,/else\s*\{/);
});
