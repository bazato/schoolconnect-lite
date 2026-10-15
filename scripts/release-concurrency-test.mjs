// Synthetic acceptance only; intentionally refuses remote targets and other local stacks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testSignIn } from './test-sign-in.mjs';

const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:3390/api/v1';
assert.equal(base, 'http://127.0.0.1:3390/api/v1', 'ISOLATED_RELEASE_API_REQUIRED');
const count = 100;
const suffix = String(Date.now()).slice(-8);
const phone = (id) => `+99${suffix}${String(id).padStart(3, '0')}`;
const request = async (path, token, body, expected) => {
  const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (expected) assert.equal(response.status, expected, `${path}: unexpected status`);
  else assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return data;
};
const login = (number, invite) => testSignIn(base, number, invite, `release-${randomUUID()}`);
async function parallel(items, workers, handler) {
  let index = 0;
  const results = Array(items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (index < items.length) { const current = index++; results[current] = await handler(items[current], current); }
  }));
  return results;
}

console.log('Creating an isolated synthetic school, teacher and 100 distinct parent accounts.');
const owner = await login('+919876543200', 'OWNER-INVITE');
const school = await request('/admin/schools', owner.accessToken, { schoolCode: `LC${suffix}`, displayName: 'Isolated 100-user acceptance school', timezone: 'Asia/Riyadh', adminDisplayName: 'Synthetic Administrator', adminPhoneE164: phone(0) });
const admin = await login(phone(0), school.administrator.invitationCode);
const classes = await Promise.all([0, 1].map((n) => request('/admin/classes', admin.accessToken, { classCode: `G${n + 1}`, gradeCode: `G${n + 1}`, displayName: `Synthetic Class ${n + 1}`, academicYear: '2026-2027' })));
const provision = await request('/admin/teachers', admin.accessToken, { displayName: 'Synthetic Teacher', phoneE164: phone(1), classId: classes[0].id, subjectCode: 'MATH', subjectName: 'Mathematics', canPublishAnnouncements: true, canRecordAttendance: true });
await request(`/admin/teachers/${provision.teacher.membershipId}/assignments`, admin.accessToken, { classId: classes[1].id, subjectCode: 'MATH', subjectName: 'Mathematics', canPublishAnnouncements: true, canRecordAttendance: true });
const teacher = await login(phone(1), provision.teacher.invitationCode);
const parents = await parallel(Array.from({ length: count }, (_, n) => n), 4, async (n) => {
  const child = await request('/admin/parents', admin.accessToken, { displayName: `Synthetic Parent ${n}`, phoneE164: phone(100 + n), studentDisplayName: `Synthetic Child ${n}`, admissionNumber: `LOAD-${n}`, classId: classes[n % 2].id });
  const session = await login(phone(100 + n), child.parent.invitationCode);
  if ((n + 1) % 20 === 0) console.log(`${n + 1}/100 synthetic sessions prepared.`);
  return { session, studentId: child.student.studentId, classIndex: n % 2 };
});
assert.equal(new Set(parents.map((p) => p.session.accessToken)).size, count);
await request(`/timeline/${parents[1].studentId}`, parents[0].session.accessToken, undefined, 403);
await request('/admin/operations/events', parents[0].session.accessToken, undefined, 403);
await request('/admin/operations/events', admin.accessToken, undefined, 403);

console.log('Running 100 simultaneous distinct parent sessions (500 reads), with teacher publishing into both classes.');
const started = performance.now();
const results = [];
const writes = Promise.all(classes.map((c, n) => request('/posts', teacher.accessToken, { classId: c.id, postType: 'ANNOUNCEMENT', title: `Concurrent acceptance ${n}`, body: 'Synthetic load test only.', audienceType: 'CLASS', urgent: false, idempotencyKey: randomUUID() })));
await Promise.all(parents.map(async (p) => {
  const paths = ['/me/context', `/bff/parent/home?studentId=${p.studentId}`, `/timeline/${p.studentId}?limit=20`, '/notifications?limit=20', '/me/children'];
  for (const path of paths) {
    const began = performance.now();
    try {
      const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${p.session.accessToken}` }, signal: AbortSignal.timeout(15000) });
      await response.arrayBuffer();
      results.push({ path: path.split('?')[0].replace(p.studentId, ':studentId'), status: response.status, ms: performance.now() - began });
    } catch { results.push({ path: path.split('?')[0].replace(p.studentId, ':studentId'), status: 0, ms: performance.now() - began }); }
  }
}));
const posts = await writes;
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const percentile = (p) => Math.round(times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)]);
const statusCounts = {};
for (const r of results) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
const report = { scope: 'isolated local PostgreSQL/Kafka API acceptance; not hosted/device capacity', distinctParentSessions: count, simultaneousClients: count, reads: results.length, concurrentTeacherPublishes: posts.length, elapsedMs: Math.round(performance.now() - started), statusCounts, failures: results.filter((r) => r.status !== 200).length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: Math.round(times.at(-1)) };
report.endpoints = [...new Set(results.map((r) => r.path))].map((path) => {
  const samples = results.filter((r) => r.path === path).map((r) => r.ms).sort((a, b) => a - b);
  return { path, requests: samples.length, p95Ms: Math.round(samples[Math.ceil(samples.length * 0.95) - 1]) };
});
console.log(JSON.stringify(report, null, 2));

const until = Date.now() + 20000;
let delivered = false;
while (Date.now() < until) {
  const matches = await Promise.all([parents[0], parents[1]].map(async (p) => (await request(`/timeline/${p.studentId}`, p.session.accessToken)).some((post) => post.id === posts[p.classIndex].id)));
  if (matches.every(Boolean)) { delivered = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.ok(delivered, 'Concurrent posts did not reach both class projections.');
const diagnostics = await request('/admin/operations/events', owner.accessToken);
assert.ok(diagnostics, 'Owner diagnostics missing.');
console.log('Passed: 100 distinct parent sessions, concurrent two-class publishing, cross-child denial, owner-only diagnostics and Kafka-built timeline delivery. Synthetic fixtures retained only in the isolated test volume.');
assert.equal(report.failures, 0);
assert.ok(report.p95Ms < 3000, 'Local acceptance p95 exceeded 3000 ms; investigate before release.');
