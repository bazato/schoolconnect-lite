import assert from 'node:assert/strict';

const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const users = Number(process.env.LOAD_USERS ?? 100);
const requestsPerUser = Number(process.env.LOAD_REQUESTS_PER_USER ?? 5);
const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};
const challenge = await post('/auth/otp/request', { phoneE164: '+919876543210' });
const session = await post('/auth/otp/verify', { challengeId: challenge.challengeId, code: challenge.developmentCode ?? '123456', deviceId: 'load-test-device' });
const authorized = async (path) => {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  return { status: response.status, duration: performance.now() - started };
};
const childrenResponse = await fetch(`${base}/me/children`, { headers: { authorization: `Bearer ${session.accessToken}` } });
const children = await childrenResponse.json();
assert.ok(children[0]?.id, 'seed parent has no child');
const paths = ['/me/context', `/timeline/${children[0].id}?limit=20`, '/notifications?limit=20'];
// Model `users` concurrently active clients. Each client issues its own requests
// sequentially, as a mobile application does, instead of creating an artificial
// `users * requestsPerUser` connection spike at the same instant.
const results = (await Promise.all(Array.from({ length: users }, async (_, user) => {
  const userResults = [];
  for (let request = 0; request < requestsPerUser; request += 1) {
    userResults.push(await authorized(paths[(user + request) % paths.length]));
  }
  return userResults;
}))).flat();
const failures = results.filter((result) => result.status !== 200);
const durations = results.map((result) => result.duration).sort((a, b) => a - b);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))];
const report = { users, requests: results.length, failures: failures.length, p50Ms: Math.round(percentile(0.5)), p95Ms: Math.round(percentile(0.95)), p99Ms: Math.round(percentile(0.99)), maxMs: Math.round(durations.at(-1) ?? 0) };
console.log(JSON.stringify(report, null, 2));
assert.equal(failures.length, 0);
// The default budget is intentionally for the complete local development stack
// (nine watch-mode Node processes plus Docker Desktop). Production deployments
// should set LOAD_P95_TARGET_MS to their stricter SLO in CI/performance staging.
assert.ok(report.p95Ms < Number(process.env.LOAD_P95_TARGET_MS ?? 3000), `p95 ${report.p95Ms}ms exceeded target`);
