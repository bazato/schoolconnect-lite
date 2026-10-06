import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const call = async (path, { token, expected = 200, ...init } = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (Array.isArray(expected) ? !expected.includes(response.status) : response.status !== expected) throw new Error(`${init.method ?? 'GET'} ${path}: expected ${expected}, got ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const send = (path, token, body, method = 'POST') => call(path, { token, method, body: JSON.stringify(body), expected: [200, 201] });
const eventually = async (check, timeoutMs = 10_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('EVENT_PROJECTION_TIMEOUT');
};
const login = async (phoneE164, invitationCode) => {
  let challenge;
  try { challenge = await send('/auth/otp/request', undefined, { phoneE164, invitationCode }); }
  catch (error) { if (!invitationCode || !(error instanceof Error) || !error.message.includes('INVITATION_OR_PHONE_INVALID')) throw error; challenge = await send('/auth/otp/request', undefined, { phoneE164 }); }
  return send('/auth/otp/verify', undefined, { challengeId: challenge.challengeId, code: challenge.developmentCode ?? '123456', deviceId: `product-${randomUUID()}` });
};

const suffix = String(Date.now()).slice(-8);
console.log('1/9 owner and school account lifecycle');
const owner = await login('+919876543200', 'OWNER-INVITE');
const newOwner = await send('/admin/platform-owners', owner.accessToken, { displayName: 'Additional Owner', phoneE164: `+96659${suffix}` });
assert.equal((await call('/admin/platform-owners', { token: owner.accessToken })).some((item) => item.membershipId === newOwner.membershipId), true);
await send(`/admin/platform-owners/${newOwner.membershipId}`, owner.accessToken, { displayName: 'Additional Owner Updated' }, 'PATCH');
const school = await send('/admin/schools', owner.accessToken, { schoolCode: `PT${suffix}`, displayName: 'Product Test School', timezone: 'Asia/Riyadh', adminDisplayName: 'Test Admin', adminPhoneE164: `+96650${suffix}` });
const admin = await login(`+96650${suffix}`, school.administrator.invitationCode);
await send(`/admin/schools/${school.school.id}/admins`, owner.accessToken, { displayName: 'Second Admin', phoneE164: `+96658${suffix}` });
assert.equal((await call(`/admin/schools/${school.school.id}/admins`, { token: owner.accessToken })).length, 2);

console.log('2/9 class, teacher, parent and audience configuration');
const firstClass = await send('/admin/classes', admin.accessToken, { classCode: 'G1A', gradeCode: 'G1', displayName: 'Grade 1 A', academicYear: '2026-2027' });
const secondClass = await send('/admin/classes', admin.accessToken, { classCode: 'G1B', gradeCode: 'G1', displayName: 'Grade 1 B', academicYear: '2026-2027' });
await send('/admin/configuration', admin.accessToken, { scheduledAnnouncementsEnabled: true, gradeWideAnnouncementsEnabled: true, schoolWideAnnouncementsEnabled: true }, 'PATCH');
const teacherProvision = await send('/admin/teachers', admin.accessToken, { displayName: 'Test Teacher', phoneE164: `+96651${suffix}`, classId: firstClass.id, subjectCode: 'MATH', subjectName: 'Mathematics', canPublishAnnouncements: true, canRecordAttendance: true, canPublishGradeWide: true, canPublishSchoolWide: true });
const teacher = await login(`+96651${suffix}`, teacherProvision.teacher.invitationCode);
const firstParentProvision = await send('/admin/parents', admin.accessToken, { displayName: 'First Parent', phoneE164: `+96652${suffix}`, studentDisplayName: 'First Student', admissionNumber: `P1-${suffix}`, classId: firstClass.id });
const secondParentProvision = await send('/admin/parents', admin.accessToken, { displayName: 'Second Parent', phoneE164: `+96653${suffix}`, studentDisplayName: 'Second Student', admissionNumber: `P2-${suffix}`, classId: secondClass.id });
const firstParent = await login(`+96652${suffix}`, firstParentProvision.parent.invitationCode);
const secondParent = await login(`+96653${suffix}`, secondParentProvision.parent.invitationCode);

console.log('3/9 grade publishing, read report and archive');
const gradePost = await send('/posts', teacher.accessToken, { classId: firstClass.id, postType: 'ANNOUNCEMENT', title: 'Grade announcement', body: 'For the entire grade', audienceType: 'GRADE', urgent: false, idempotencyKey: randomUUID() });
assert.equal(gradePost.recipientCount, 2);
await eventually(async () => (await call(`/timeline/${firstParentProvision.student.studentId}`, { token: firstParent.accessToken })).some((item) => item.id === gradePost.id));
await eventually(async () => (await call(`/timeline/${secondParentProvision.student.studentId}`, { token: secondParent.accessToken })).some((item) => item.id === gradePost.id));
await send(`/posts/${gradePost.id}/view`, firstParent.accessToken, { studentId: firstParentProvision.student.studentId });
const gradeDetail = await call(`/posts/${gradePost.id}?studentId=${firstParentProvision.student.studentId}`, { token: firstParent.accessToken });
assert.equal(gradeDetail.title, 'Grade announcement');
assert.deepEqual(gradeDetail.attachments, []);
const report = await call(`/posts/${gradePost.id}/report`, { token: teacher.accessToken });
assert.equal(report.recipientCount, 2);
assert.equal(report.viewedCount, 1);
await send(`/posts/${gradePost.id}/archive`, teacher.accessToken, { expectedRevisionNumber: 1 });
await send(`/posts/${gradePost.id}/archive`, teacher.accessToken, { expectedRevisionNumber: 1 });
await eventually(async () => !(await call(`/timeline/${firstParentProvision.student.studentId}`, { token: firstParent.accessToken })).some((item) => item.id === gradePost.id));
const urgentPayload = { classId: firstClass.id,postType: 'ANNOUNCEMENT',title: 'Urgent notice',body: 'Granted urgent notice',audienceType: 'CLASS',urgent: true,idempotencyKey: randomUUID() };
await call('/posts', { token: teacher.accessToken,method: 'POST',body: JSON.stringify(urgentPayload),expected: 403 });
await send('/admin/configuration',admin.accessToken,{ urgentAnnouncementsEnabled: true },'PATCH');
const urgentAssignment = (await call(`/admin/teachers/${teacherProvision.teacher.membershipId}/assignments`,{ token: admin.accessToken }))[0];
await send(`/admin/assignments/${urgentAssignment.assignmentId}`,admin.accessToken,{ canPublishUrgent: true },'PATCH');
assert.equal((await send('/posts',teacher.accessToken,urgentPayload)).status,'PUBLISHED');
const draft = await send('/drafts',teacher.accessToken,{ classId:firstClass.id,postType:'ANNOUNCEMENT',payload:{title:'Restorable draft',body:'Draft message'} });
assert.ok((await call('/drafts',{ token:teacher.accessToken })).some((item)=>item.id===draft.id && item.payload.title==='Restorable draft'));
await send(`/drafts/${draft.id}/delete`,teacher.accessToken,{});

console.log('4/9 scheduled announcement');
const scheduled = await send('/posts', teacher.accessToken, { classId: firstClass.id, postType: 'ANNOUNCEMENT', title: 'Scheduled notice', body: 'Published by worker', audienceType: 'CLASS', urgent: false, scheduledFor: new Date(Date.now() + 5000).toISOString(), idempotencyKey: randomUUID() });
assert.equal(scheduled.status, 'SCHEDULED');
await eventually(async () => (await call('/teacher-posts',{ token:teacher.accessToken })).find((item)=>item.id===scheduled.id)?.scheduledFor);
const scheduledRevision = await send(`/posts/${scheduled.id}/revisions`,teacher.accessToken,{ expectedRevisionNumber:1,title:'Edited scheduled notice',body:'Edited before release',scheduledFor:new Date(Date.now()+6000).toISOString() });
assert.equal(scheduledRevision.status,'SCHEDULED');
await new Promise((resolve) => setTimeout(resolve, 8000));
await eventually(async () => (await call(`/timeline/${firstParentProvision.student.studentId}`, { token: firstParent.accessToken })).find((item) => item.id === scheduled.id)?.title === 'Edited scheduled notice');

console.log('5/9 CSV import and student/guardian lifecycle');
const csv = `studentDisplayName,admissionNumber,classCode,parentDisplayName,parentPhoneE164,relationship\nImported Student,IMP-${suffix},G1A,Imported Parent,+96654${suffix},Parent`;
const preview = await send('/admin/students/import-preview', admin.accessToken, { csv });
assert.equal(preview.valid, true);
const imported = await send('/admin/students/import', admin.accessToken, { csv });
assert.equal(imported.imported, 1);
const students = await call('/admin/students', { token: admin.accessToken });
const importedStudent = students.find((item) => item.admissionNumber === `IMP-${suffix}`);
assert.ok(importedStudent);
await send(`/admin/students/${importedStudent.id}`, admin.accessToken, { classId: secondClass.id, displayName: 'Imported Student Updated' }, 'PATCH');
const moved = (await call('/admin/students', { token: admin.accessToken })).find((item) => item.id === importedStudent.id);
assert.equal(moved.classId, secondClass.id);
await send(`/admin/students/${importedStudent.id}/guardians/${firstParentProvision.parent.userId}/link`, admin.accessToken, { active: true });
assert.equal((await call(`/me/children`, { token: firstParent.accessToken })).length, 2);
await send(`/admin/students/${importedStudent.id}/guardians/${firstParentProvision.parent.userId}/link`, admin.accessToken, { active: false });
assert.equal((await call(`/me/children`, { token: firstParent.accessToken })).length, 1);

console.log('6/9 leave review and attendance correction');
const date = new Date().toISOString().slice(0, 10);
const roster = await call(`/attendance/roster?classId=${firstClass.id}`, { token: teacher.accessToken });
const version = await call(`/attendance/version?classId=${firstClass.id}&attendanceDate=${date}`, { token: teacher.accessToken });
const firstBatch = await send('/attendance/batches', teacher.accessToken, { classId: firstClass.id, attendanceDate: date, expectedVersion: version.version, correctionReason: version.version ? 'Product test correction' : undefined, idempotencyKey: randomUUID(), rows: roster.map((item) => ({ studentId: item.id, status: item.id === firstParentProvision.student.studentId ? 'ABSENT' : 'PRESENT' })) });
const history = await call(`/attendance/students/${firstParentProvision.student.studentId}`, { token: firstParent.accessToken });
const absence = history.find((item) => item.attendanceStatus === 'ABSENT');
assert.ok(absence);
await send(`/attendance/events/${absence.id}/acknowledgements`, firstParent.accessToken, { idempotencyKey: randomUUID(), reason: 'Family appointment', leaveNote: true });
const leaves = await call('/admin/leave-requests', { token: admin.accessToken });
const leave = leaves.find((item) => item.attendanceEventId === absence.id);
assert.ok(leave);
await send(`/admin/leave-requests/${leave.id}/review`, admin.accessToken, { decision: 'APPROVED', reviewNote: 'Approved after review' });
await send('/attendance/batches', teacher.accessToken, { classId: firstClass.id, attendanceDate: date, expectedVersion: firstBatch.version, correctionReason: 'Correcting attendance after review', idempotencyKey: randomUUID(), rows: roster.map((item) => ({ studentId: item.id, status: 'PRESENT' })) });
const corrected = await call(`/attendance/students/${firstParentProvision.student.studentId}`, { token: firstParent.accessToken });
assert.equal(corrected[0].attendanceStatus, 'PRESENT');
const correctionContext = await call(`/admin/attendance/correction-context?classId=${firstClass.id}&attendanceDate=${date}`, { token: admin.accessToken });
assert.equal(correctionContext.version, firstBatch.version + 1);
await call(`/admin/attendance/correction-context?classId=${firstClass.id}&attendanceDate=${date}`, { token: firstParent.accessToken, expected: 403 });
await send('/admin/attendance/corrections', admin.accessToken, { classId: firstClass.id, attendanceDate: date, expectedVersion: correctionContext.version, correctionReason: 'Administrator escalation after parent review', idempotencyKey: randomUUID(), rows: correctionContext.roster.map((item) => ({ studentId: item.id, status: item.id === firstParentProvision.student.studentId ? 'LATE' : 'PRESENT' })) });
assert.equal((await call(`/attendance/students/${firstParentProvision.student.studentId}`, { token: firstParent.accessToken }))[0].attendanceStatus, 'LATE');

console.log('7/9 teacher lifecycle and school reports');
const assignments = await call(`/admin/teachers/${teacherProvision.teacher.membershipId}/assignments`, { token: admin.accessToken });
assert.equal(assignments.length, 1);
await send(`/admin/assignments/${assignments[0].assignmentId}`, admin.accessToken, { classId: secondClass.id }, 'PATCH');
assert.equal((await call('/me/teaching-scope', { token: teacher.accessToken }))[0].classId, secondClass.id);
const summary = await call(`/admin/reports/summary?fromDate=${date}&toDate=${date}`, { token: admin.accessToken });
assert.ok(summary.studentCount >= 3);
assert.ok(Array.isArray(summary.attendance));
await eventually(async () => (await call('/admin/reports/audit', { token: admin.accessToken })).some((item) => item.action === 'school.teacher-assignment-updated.v1'));
const platformReport = await call('/admin/reports/platform-summary', { token: owner.accessToken });
assert.ok(platformReport.schools.some((item) => item.schoolId === school.school.id && item.activeStudentCount >= 3 && item.activeTeacherCount >= 1));
await call('/admin/reports/platform-summary', { token: admin.accessToken, expected: 403 });

console.log('8/9 academic rollover');
const rollover = await send('/admin/academic-years/rollover', admin.accessToken, { fromYear: '2026-2027', toYear: '2027-2028' });
assert.equal(rollover.classesCreated, 2);
assert.equal((await call('/admin/classes', { token: admin.accessToken })).filter((item) => item.academicYear === '2027-2028').length, 2);

console.log('9/9 school suspension and tenant access');
await send(`/admin/schools/${school.school.id}`, owner.accessToken, { status: 'SUSPENDED' }, 'PATCH');
await call('/admin/classes', { token: admin.accessToken, expected: 403 });
await send(`/admin/schools/${school.school.id}`, owner.accessToken, { status: 'ACTIVE' }, 'PATCH');
assert.ok((await call('/admin/classes', { token: admin.accessToken })).length);
console.log('Product workflows passed.');
