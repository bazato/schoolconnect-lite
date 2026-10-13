import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testSignIn } from './test-sign-in.mjs';

const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:3010/api/v1';
const call = async (path, token, body, method = body ? 'POST' : 'GET', expected) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (expected) assert.equal(response.status, expected, JSON.stringify(result));
  else assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
};
const login = async (phoneE164, invitationCode) => {
  return testSignIn(base,phoneE164,invitationCode,`regression-${randomUUID()}`);
};
const suffix = String(Date.now()).slice(-8);
const owner = await login('+919876543200', 'OWNER-INVITE');
const school = await call('/admin/schools', owner.accessToken, { schoolCode: `RG${suffix}`, displayName: `Regression School ${suffix}`, timezone: 'Asia/Riyadh', adminDisplayName: 'Regression Administrator', adminPhoneE164: `+96650${suffix}` });
const admin = await login(`+96650${suffix}`, school.administrator.invitationCode);
const classes = [];
for (const code of ['ONE', 'TWO']) classes.push(await call('/admin/classes', admin.accessToken, { classCode: code, displayName: `Class ${code}`, academicYear: '2026-2027', gradeCode: code }));
const first = await call(`/admin/classes/${classes[0].id}`, admin.accessToken, { displayName: 'Class One Edited', classCode: 'ONE-EDIT', gradeCode: 'G1' }, 'PATCH');
assert.equal(first.id, classes[0].id); assert.equal(first.displayName, 'Class One Edited');
await call(`/admin/classes/${classes[1].id}`, admin.accessToken, { classCode: 'ONE-EDIT' }, 'PATCH', 409);
await call(`/admin/classes/${classes[0].id}`, admin.accessToken, { displayName: '' }, 'PATCH', 400);
const provision = await call('/admin/teachers', admin.accessToken, { displayName: 'Regression Teacher', phoneE164: `+96651${suffix}`, classId: first.id, subjectCode: 'MATH', subjectName: 'Mathematics', canPublishAnnouncements: true, canRecordAttendance: true });
const teacher = await login(`+96651${suffix}`, provision.teacher.invitationCode);
assert.equal((await call('/me/teaching-scope', teacher.accessToken)).length, 1);
await call(`/admin/teachers/${provision.teacher.membershipId}/assignments`, admin.accessToken, { classId: classes[1].id, subjectCode: 'SCI', subjectName: 'Science', canPublishResults: true, canPublishAnnouncements: true, canRecordAttendance: true });
// Repeated assignment submission must not create a duplicate.
await call(`/admin/teachers/${provision.teacher.membershipId}/assignments`, admin.accessToken, { classId: classes[1].id, subjectCode: 'SCI', subjectName: 'Science', canPublishResults: true, canPublishAnnouncements: true, canRecordAttendance: true });
assert.equal((await call('/me/teaching-scope', teacher.accessToken)).length, 2);
const teacherHome = await call('/bff/teacher/home', teacher.accessToken); assert.equal(teacherHome.teachingScope.length, 2);
await call(`/admin/members/${provision.teacher.membershipId}`, admin.accessToken, { displayName: 'Teacher Edited' }, 'PATCH');
assert.equal((await call('/me/context', teacher.accessToken)).principal.displayName, 'Teacher Edited');
assert.equal((await call('/me/context', teacher.accessToken)).school.displayName, school.school.displayName);
const children = [];
let parent;
for (const [index, c] of classes.entries()) {
  children.push(await call('/admin/parents', admin.accessToken, { displayName: 'Regression Parent', phoneE164: `+96652${suffix}`, studentDisplayName: index ? 'Second Child With A Long Name For Layout Regression' : 'First Child', admissionNumber: `RG-${suffix}-${index}`, classId: c.id }));
  if (!index) parent = await login(`+96652${suffix}`, children[0].parent.invitationCode);
}
assert.equal(children[1].parent.invitationCode, null);
assert.equal(children[1].parent.invitationStatus, 'ALREADY_ACTIVE');
assert.equal((await call('/me/children', parent.accessToken)).length, 2);
// The same teacher switches A -> B: every action must retain its own class data.
const date = new Date().toISOString().slice(0, 10);
const published = [];
for (const [index, c] of classes.entries()) {
  const roster = await call(`/attendance/roster?classId=${c.id}`, teacher.accessToken);
  assert.deepEqual(roster.map((s) => s.id), [children[index].student.studentId]);
  const version = await call(`/attendance/version?classId=${c.id}&attendanceDate=${date}`, teacher.accessToken);
  await call('/attendance/batches', teacher.accessToken, { classId: c.id, attendanceDate: date, expectedVersion: version.version, idempotencyKey: randomUUID(), rows: roster.map((student) => ({ studentId: student.id, status: 'ABSENT' })) });
  for (const postType of ['HOMEWORK', 'ANNOUNCEMENT']) published.push({ index, post: await call('/posts', teacher.accessToken, { classId: c.id, subjectCode: index ? 'SCI' : 'MATH', postType, title: `${postType} class ${index}`, body: 'Class switching regression', audienceType: 'CLASS', dueDate: postType === 'HOMEWORK' ? date : undefined, idempotencyKey: randomUUID() }) });
}
// Database/outbox projections are asynchronous; wait for both classes, then assert isolation.
let projected = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const timelines = await Promise.all(children.map((c) => call(`/timeline/${c.student.studentId}`, parent.accessToken)));
  const followUps = await Promise.all(classes.map((c) => call(`/attendance/follow-ups?classId=${c.id}&attendanceDate=${date}`, teacher.accessToken)));
  projected = published.every(({ index, post }) => timelines[index].some((item) => item.id === post.id)) && followUps.every((items, index) => items.some((item) => item.studentId === children[index].student.studentId));
  if (projected) {
    for (const [index, timeline] of timelines.entries()) assert.ok(published.filter((p) => p.index !== index).every(({ post }) => !timeline.some((item) => item.id === post.id)));
    for (const [index, items] of followUps.entries()) assert.ok(items.every((item) => item.studentId === children[index].student.studentId));
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(projected, 'Both class timelines and follow-ups should finish projecting');
await call('/attendance/batches', teacher.accessToken, { classId: classes[1].id, attendanceDate: date, expectedVersion: 1, correctionReason: 'Cross-class roster must be rejected', idempotencyKey: randomUUID(), rows: [{ studentId: children[0].student.studentId, status: 'PRESENT' }] }, 'POST', 400);
await call(`/admin/students/${children[1].student.studentId}`, admin.accessToken, { displayName: 'Second Child Edited With A Long Name For Layout Regression', classId: classes[0].id, status: 'ACTIVE' }, 'PATCH');
const parentChildren = await call('/me/children', parent.accessToken);
assert.equal(parentChildren.find((c) => c.id === children[1].student.studentId).classId, classes[0].id);
assert.ok(parentChildren.every((c) => c.schoolName === school.school.displayName));
await call(`/admin/classes/${first.id}`, parent.accessToken, { displayName: 'Denied' }, 'PATCH', 403);
await call(`/admin/teachers/${provision.teacher.membershipId}/assignments`, parent.accessToken, { classId: first.id, subjectName: 'Denied', subjectCode: 'BAD' }, 'POST', 403);
const otherSchool = await call('/admin/schools', owner.accessToken, { schoolCode: `RX${suffix}`, displayName: 'Other Regression School', timezone: 'Asia/Riyadh', adminDisplayName: 'Other Administrator', adminPhoneE164: `+96653${suffix}` });
const otherAdmin = await login(`+96653${suffix}`, otherSchool.administrator.invitationCode);
await call(`/admin/classes/${first.id}`, otherAdmin.accessToken, { displayName: 'Denied' }, 'PATCH', 404);
await call(`/admin/teachers/${provision.teacher.membershipId}/assignments`, otherAdmin.accessToken, { classId: first.id, subjectName: 'Denied', subjectCode: 'BAD' }, 'POST', 403);
await call(`/admin/classes/${classes[1].id}`, admin.accessToken, { status: 'ARCHIVED' }, 'PATCH');
assert.equal((await call('/me/teaching-scope', teacher.accessToken)).length, 1);
await call(`/attendance/roster?classId=${classes[1].id}`, teacher.accessToken, null, 'GET', 403);
await call(`/admin/classes/${classes[1].id}`, admin.accessToken, { status: 'ACTIVE' }, 'PATCH');
assert.equal((await call('/me/teaching-scope', teacher.accessToken)).length, 2);
console.log('Passed: class/teacher/student edits, two assignments, publishing/attendance/follow-ups across both classes, cross-class isolation, duplicate assignment protection, sibling reuse, school names, archived-class denial, and cross-school authorization.');
console.log(JSON.stringify({ school: school.school.displayName, adminPhone: `+96650${suffix}`, teacherPhone: `+96651${suffix}`, parentPhone: `+96652${suffix}`, otp: '123456' }));
