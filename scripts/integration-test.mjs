import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const call = async (path, { token, expected = 200, ...init } = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (Array.isArray(expected) ? !expected.includes(response.status) : response.status !== expected) throw new Error(`${init.method ?? 'GET'} ${path}: expected ${expected}, got ${response.status} ${JSON.stringify(body)}`);
  return { status: response.status, body };
};

async function challenge(phoneE164, invitationCode) {
  let response = await call('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phoneE164, invitationCode }), expected: [200, 201, 400] });
  if (response.status === 400) response = await call('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phoneE164 }), expected: [200, 201] });
  return response.body;
}

async function login(phoneE164, invitationCode, deviceId = `integration-${randomUUID()}`) {
  const requested = await challenge(phoneE164, invitationCode);
  const verified = await call('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ challengeId: requested.challengeId, code: requested.developmentCode ?? '123456', deviceId }), expected: [200, 201] });
  return { ...verified.body, deviceId };
}

console.log('1/8 atomic OTP consumption');
const ownerChallenge = await challenge('+919876543200', 'OWNER-INVITE');
const ownerDevice = `integration-owner-${randomUUID()}`;
const duplicateVerify = await Promise.all([0, 1].map(async () => {
  const response = await fetch(`${base}/auth/otp/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: ownerChallenge.challengeId, code: ownerChallenge.developmentCode ?? '123456', deviceId: ownerDevice }) });
  return { status: response.status, body: await response.json() };
}));
assert.deepEqual(duplicateVerify.map((item) => item.status).sort(), [201, 400]);
let owner = duplicateVerify.find((item) => item.status === 201).body;

console.log('2/8 rotating refresh and reuse detection');
const firstRefresh = await call('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: owner.refreshToken, deviceId: ownerDevice }), expected: [200, 201] });
await call('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: owner.refreshToken, deviceId: ownerDevice }), expected: 401 });
await call('/me/context', { token: firstRefresh.body.accessToken, expected: 401 });
owner = await login('+919876543200', '', ownerDevice);

console.log('3/8 owner → school admin provisioning with compensation-safe APIs');
const suffix = String(Date.now()).slice(-8);
const schoolResult = await call('/admin/schools', { token: owner.accessToken, method: 'POST', body: JSON.stringify({ schoolCode: `IT${suffix}`, displayName: `Integration School ${suffix}`, timezone: 'Asia/Riyadh', adminDisplayName: 'Integration Admin', adminPhoneE164: `+96650${suffix}` }), expected: [200, 201] });
const admin = await login(`+96650${suffix}`, schoolResult.body.administrator.invitationCode);
const schoolClass = await call('/admin/classes', { token: admin.accessToken, method: 'POST', body: JSON.stringify({ classCode: 'G1A', displayName: 'Grade 1A', academicYear: '2026-2027' }), expected: [200, 201] });
const parentPhone = `+96651${suffix}`;
const parentProvision = await call('/admin/parents', { token: admin.accessToken, method: 'POST', body: JSON.stringify({ displayName: 'Integration Parent', phoneE164: parentPhone, studentDisplayName: 'Integration Student', admissionNumber: `IT-${suffix}`, classId: schoolClass.body.id, relationship: 'Parent' }), expected: [200, 201] });
const newParent = await login(parentPhone, parentProvision.body.parent.invitationCode);
const newChildren = await call('/me/children', { token: newParent.accessToken });
assert.equal(newChildren.body.length, 1);

console.log('4/8 teacher roster-scoped atomic attendance');
const teacher = await login('+919876543211', 'TEACHER-INVITE');
const scope = await call('/me/teaching-scope', { token: teacher.accessToken });
const assignment = scope.body[0];
const roster = await call(`/attendance/roster?classId=${assignment.classId}`, { token: teacher.accessToken });
const date = new Date().toISOString().slice(0, 10);
const version = await call(`/attendance/version?classId=${assignment.classId}&attendanceDate=${date}`, { token: teacher.accessToken });
const attendance = await call('/attendance/batches', { token: teacher.accessToken, method: 'POST', body: JSON.stringify({ classId: assignment.classId, attendanceDate: date, expectedVersion: version.body.version, correctionReason: version.body.version ? 'Integration test correction' : undefined, idempotencyKey: randomUUID(), rows: roster.body.map((student, index) => ({ studentId: student.id, status: index === 0 ? 'ABSENT' : 'PRESENT' })) }), expected: [200, 201] });
assert.equal(attendance.body.rowCount, roster.body.length);

console.log('5/8 outbox notification delivery');
await new Promise((resolve) => setTimeout(resolve, 3500));
const seededParent = await login('+919876543210', 'PARENT-INVITE');
const notifications = await call('/notifications', { token: seededParent.accessToken });
const absenceNotification = notifications.body.find((item) => item.resourceType === 'ATTENDANCE_EVENT' && item.resourceId);
assert.ok(absenceNotification, 'absence notification was not delivered');

console.log('6/8 concurrent guardian acknowledgement idempotency');
const acknowledgementKey = randomUUID();
const acknowledgements = await Promise.all([0, 1].map(() => call(`/attendance/events/${absenceNotification.resourceId}/acknowledgements`, { token: seededParent.accessToken, method: 'POST', body: JSON.stringify({ idempotencyKey: acknowledgementKey, reason: 'Integration test', leaveNote: false }), expected: [200, 201] })));
assert.equal(acknowledgements[0].body.id, acknowledgements[1].body.id);
const followUps = await call(`/attendance/follow-ups?classId=${assignment.classId}&attendanceDate=${date}`, { token: teacher.accessToken });
assert.ok(followUps.body.some((item) => item.attendanceEventId === absenceNotification.resourceId && item.responseStatus === 'ACKNOWLEDGED'));

console.log('7/8 cross-tenant and invalid-roster rejection');
await call(`/timeline/${newChildren.body[0].id}`, { token: seededParent.accessToken, expected: 403 });
await call('/attendance/batches', { token: teacher.accessToken, method: 'POST', body: JSON.stringify({ classId: assignment.classId, attendanceDate: date, expectedVersion: attendance.body.version, idempotencyKey: randomUUID(), rows: [{ studentId: randomUUID(), status: 'PRESENT' }] }), expected: 400 });

console.log('8/8 genuine logout revocation');
await call('/auth/logout', { token: seededParent.accessToken, method: 'POST', expected: [200, 201] });
await call('/me/context', { token: seededParent.accessToken, expected: 401 });
await call('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: seededParent.refreshToken, deviceId: seededParent.deviceId }), expected: 401 });

console.log('Integration security and concurrency checks passed.');
