import { Test } from '@nestjs/testing';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule, ServiceClient } from './app.module';
import { requestContextMiddleware } from './request-context';
import type { INestApplication } from '@nestjs/common';

const parent = { userId: 'parent-1', displayName: 'Parent', membershipId: 'membership-parent', schoolId: 'school-1', role: 'PARENT', sessionId: 'session-parent' };
const teacher = { userId: 'teacher-1', displayName: 'Teacher', membershipId: 'membership-teacher', schoolId: 'school-1', role: 'TEACHER', sessionId: 'session-teacher' };
const owner = { userId: 'owner-1', displayName: 'Owner', membershipId: 'membership-owner', schoolId: null, role: 'PLATFORM_OWNER', sessionId: 'session-owner' };
const schoolAdmin = { userId: 'admin-1', displayName: 'School Admin', membershipId: 'membership-admin', schoolId: 'school-1', role: 'SCHOOL_ADMIN', sessionId: 'session-admin' };

describe('API gateway authorization and service boundaries', () => {
  let app: INestApplication;
  const serviceClient = { request: vi.fn() };

  beforeEach(async () => {
    serviceClient.request.mockReset();
    serviceClient.request.mockImplementation((service: string, path: string, init?: RequestInit) => {
      if (service === 'identity' && path.includes('/sessions/context')) {
        const token = JSON.parse(String(init?.body)).accessToken as string;
        return Promise.resolve(token === 'teacher-token' ? teacher : token === 'owner-token' ? owner : token === 'admin-token' ? schoolAdmin : parent);
      }
      if (service === 'identity' && path === '/internal/v1/sessions/switch-membership') {
        return Promise.resolve({ accessToken: 'signed-switched-token', expiresInSeconds: 600, activeMembership: { id: 'membership-parent', schoolId: 'school-1', role: 'PARENT' } });
      }
      if (service === 'school' && path === '/internal/v1/schools' && init?.method === 'POST') return Promise.resolve({ id: 'school-created', schoolCode: 'NEW1', displayName: 'New School', timezone: 'Asia/Riyadh', status: 'ACTIVE', created: true });
      if (service === 'school' && path === '/internal/v1/schools') return Promise.resolve([{ id: 'school-1', schoolCode: 'S1', displayName: 'School One' }]);
      if (service === 'school' && path === '/internal/v1/schools/school-1') return Promise.resolve({ id: 'school-1', active: true });
      if (service === 'school' && path.endsWith('/classes') && init?.method === 'POST') return Promise.resolve({ id: 'class-created', classCode: 'G5A', displayName: 'Grade 5A', academicYear: '2026-2027' });
      if (service === 'school' && path.endsWith('/classes')) return Promise.resolve([{ id: 'class-1', classCode: 'G5A', displayName: 'Grade 5A', academicYear: '2026-2027', status: 'ACTIVE' }]);
      if (service === 'school' && path.endsWith('/students')) return Promise.resolve([{ id: 'student-1', admissionNumber: 'A-001', displayName: 'Child One', classId: 'class-1', className: 'Grade 5A', guardianCount: 1, status: 'ACTIVE' }]);
      if (service === 'school' && path.endsWith('/recipients')) return Promise.resolve([{ studentId: 'student-1', guardianUserId: 'parent-1', snapshot: { studentName: 'Child One' } }]);
      if (service === 'school' && path.endsWith('/roster')) return Promise.resolve([{ id: 'student-1', displayName: 'Child One' }]);
      if (service === 'school' && path.endsWith('/children')) return Promise.resolve([{ id: 'student-1', displayName: 'Child One' }]);
      if (service === 'school' && path.endsWith('/scope')) return Promise.resolve([{ classId: 'class-1' }]);
      if (service === 'school' && path.endsWith('/teacher-assignments')) return Promise.resolve({ assignmentId: 'assignment-1', classId: 'class-1', subjectCode: 'MATH' });
      if (service === 'identity' && path === '/internal/v1/provisioning/accounts') {
        const body = JSON.parse(String(init?.body)) as { role: string };
        return Promise.resolve({ userId: 'new-user', membershipId: body.role === 'SCHOOL_ADMIN' ? 'new-admin-membership' : 'new-teacher-membership', role: body.role, invitationCode: 'SC-TEST', expiresAt: '2026-10-25T00:00:00.000Z' });
      }
      if (service === 'school' && path.includes('/authorization/guardian')) return Promise.resolve({ allowed: !path.includes('student-denied') });
      if (service === 'school' && path.includes('/authorization/teacher')) return Promise.resolve({ allowed: !path.includes('class-denied') });
      if (service === 'authorization' && path === '/internal/v1/decisions') {
        const body = JSON.parse(String(init?.body)) as { classId?: string; studentId?: string };
        return Promise.resolve({ allowed: body.classId !== 'class-denied' && body.studentId !== 'student-denied', reason: 'TEST_POLICY' });
      }
      if (service === 'authorization' && path === '/internal/v1/decisions/route') {
        const input = JSON.parse(String(init?.body)) as { path: string; principal: { role: string } };
        if (!input.path.startsWith('/api/v1/admin/')) return Promise.resolve({ allowed: true, reason: 'TEST_POLICY' });
        const platformOwnerRoute = /^\/api\/v1\/admin\/(schools|platform-owners|reports\/platform-summary)(?:\/|$)/.test(input.path);
        const auditRoute = input.path === '/api/v1/admin/reports/audit';
        const allowedRole = platformOwnerRoute ? 'PLATFORM_OWNER' : auditRoute ? undefined : 'SCHOOL_ADMIN';
        return Promise.resolve({ allowed: allowedRole ? input.principal.role === allowedRole : ['PLATFORM_OWNER', 'SCHOOL_ADMIN'].includes(input.principal.role), reason: 'TEST_POLICY' });
      }
      if (service === 'school' && path.includes('/audience-recipients')) return Promise.resolve([{ studentId: 'student-1', guardianUserId: 'parent-1', snapshot: {} }]);
      if (service === 'read' && path.startsWith('/internal/v1/timeline')) return Promise.resolve([{ id: 'post-1', title: 'Homework' }]);
      if (service === 'read' && path.startsWith('/internal/v1/teacher-posts')) return Promise.resolve([{ id: 'post-2', postType: 'ANNOUNCEMENT', title: 'School closed' }]);
      if (service === 'content' && path.startsWith('/internal/v1/drafts')) return Promise.resolve([{ id: 'draft-1' }]);
      if (service === 'attendance' && path.startsWith('/internal/v1/students/')) return Promise.resolve([{ id: 'event-1', attendanceStatus: 'PRESENT' }]);
      if (service === 'attendance' && path.startsWith('/internal/v1/attendance/projection-consistency')) return Promise.resolve({ consistent: true, mismatches: [] });
      if (service === 'notifications' && path.startsWith('/internal/v1/notifications?')) return Promise.resolve([{ id: 'notice-1' }]);
      if (service === 'content' && path === '/internal/v1/posts') return Promise.resolve({ id: 'post-created', status: 'PUBLISHED' });
      if (service === 'content' && path === '/internal/v1/results/bulk-publish') return Promise.resolve({ batchId: '123e4567-e89b-42d3-a456-426614174000', published: 1, results: [{ admissionNumber: 'A-001', studentId: 'student-1', postId: 'result-post-1', recipientCount: 1 }] });
      if (service === 'content' && path.startsWith('/internal/v1/posts/post-owned?')) return Promise.resolve({ id: 'post-owned', classId: 'class-1', postType: 'ANNOUNCEMENT', authorMembershipId: 'membership-teacher' });
      if (service === 'content' && path.startsWith('/internal/v1/posts/post-other?')) return Promise.resolve({ id: 'post-other', classId: 'class-1', postType: 'ANNOUNCEMENT', authorMembershipId: 'another-teacher' });
      if (service === 'content' && path === '/internal/v1/posts/post-owned/revisions') return Promise.resolve({ id: 'post-owned', revisionNumber: 2, status: 'UPDATED' });
      if (path === '/internal/v1/health') return Promise.resolve({ status: 'ok' });
      return Promise.resolve({});
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ServiceClient).useValue(serviceClient).compile();
    app = moduleRef.createNestApplication();
    app.use(requestContextMiddleware);
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('aggregates service health without authentication', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.services).toHaveLength(9);
  });

  it('requires authentication for protected routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/me/context').expect(401);
  });

  it('reports ready only when all backend services are healthy', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });

  it('returns an unsuccessful readiness status when a backend is unavailable', async () => {
    serviceClient.request.mockImplementation((service: string) => service === 'school' ? Promise.reject(new Error('unavailable')) : Promise.resolve({ status: 'ok' }));
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(response.body.status).toBe('degraded');
  });

  it('binds role switching to the authenticated server session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/switch-role')
      .set('Authorization', 'Bearer teacher-token')
      .send({ membershipId: 'membership-parent' })
      .expect(201);
    expect(response.body.accessToken).toBe('signed-switched-token');
    const switchCall = serviceClient.request.mock.calls.find((call) => call[0] === 'identity' && call[1] === '/internal/v1/sessions/switch-membership');
    expect(JSON.parse(String(switchCall?.[2]?.body))).toEqual({
      userId: 'teacher-1',
      membershipId: 'membership-parent',
      sessionId: 'session-teacher',
    });
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'audit' && call[1] === '/internal/v1/audit-events')).toBe(false);
  });

  it('authorizes the parent-child relationship before fetching a timeline', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/timeline/student-1').set('Authorization', 'Bearer parent-token').expect(200);
    expect(response.body[0].id).toBe('post-1');
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'authorization' && call[1] === '/internal/v1/decisions')).toBe(true);
  });

  it('denies an unrelated child before calling content', async () => {
    await request(app.getHttpServer()).get('/api/v1/timeline/student-denied').set('Authorization', 'Bearer parent-token').expect(403);
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'content')).toBe(false);
  });

  it('builds one parent mobile payload only after guardian authorization', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/bff/parent/home?studentId=student-1')
      .set('Authorization', 'Bearer parent-token').expect(200);
    expect(response.body).toMatchObject({ studentId: 'student-1', children: [{ id: 'student-1' }], timeline: [{ id: 'post-1' }], attendance: [{ id: 'event-1' }], notifications: [{ id: 'notice-1' }] });
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'authorization' && call[1] === '/internal/v1/decisions')).toBe(true);
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'read' && call[1].includes('schoolId=school-1') && call[1].includes('studentId=student-1'))).toBe(true);
  });

  it('does not query child data when parent-child authorization is denied', async () => {
    await request(app.getHttpServer()).get('/api/v1/bff/parent/home?studentId=student-denied')
      .set('Authorization', 'Bearer parent-token').expect(403);
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'content' || call[0] === 'attendance')).toBe(false);
  });

  it('exposes teacher and admin BFF payloads only to matching roles', async () => {
    const teacherHome = await request(app.getHttpServer()).get('/api/v1/bff/teacher/home')
      .set('Authorization', 'Bearer teacher-token').expect(200);
    expect(teacherHome.body).toMatchObject({ teachingScope: [{ classId: 'class-1' }], posts: [{ id: 'post-2' }], drafts: [{ id: 'draft-1' }] });
    await request(app.getHttpServer()).get('/api/v1/bff/teacher/home').set('Authorization', 'Bearer parent-token').expect(403);
    const adminHome = await request(app.getHttpServer()).get('/api/v1/bff/admin/home')
      .set('Authorization', 'Bearer admin-token').expect(200);
    expect(adminHome.body.classes).toEqual([{ id: 'class-1', classCode: 'G5A', displayName: 'Grade 5A', academicYear: '2026-2027', status: 'ACTIVE' }]);
    await request(app.getHttpServer()).get('/api/v1/bff/admin/home').set('Authorization', 'Bearer teacher-token').expect(403);
  });

  it('scopes attendance projection checks to the admin membership school', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/attendance/projection-consistency')
      .set('Authorization', 'Bearer admin-token').expect(200);
    expect(response.body).toEqual({ consistent: true, mismatches: [] });
    expect(serviceClient.request).toHaveBeenCalledWith('attendance', '/internal/v1/attendance/projection-consistency?schoolId=school-1');
    await request(app.getHttpServer()).get('/api/v1/admin/attendance/projection-consistency')
      .set('Authorization', 'Bearer teacher-token').expect(403);
  });

  it('requires school-admin confirmation for a tenant-scoped attendance rebuild', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/attendance/rebuild-projection')
      .set('Authorization', 'Bearer teacher-token').send({ confirmation: 'REBUILD_FROM_EVENTS' }).expect(403);
    await request(app.getHttpServer()).post('/api/v1/admin/attendance/rebuild-projection')
      .set('Authorization', 'Bearer admin-token').send({}).expect(400);
    await request(app.getHttpServer()).post('/api/v1/admin/attendance/rebuild-projection')
      .set('Authorization', 'Bearer admin-token').send({ confirmation: 'REBUILD_FROM_EVENTS', schoolId: 'other-school' }).expect(201);
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'attendance' && call[1] === '/internal/v1/attendance/rebuild-projection');
    expect(JSON.parse(String(downstream?.[2]?.body))).toMatchObject({ schoolId: 'school-1', actorMembershipId: 'membership-admin' });
  });

  it('snapshots guardian recipients for an attendance event', async () => {
    await request(app.getHttpServer()).post('/api/v1/attendance/batches').set('Authorization', 'Bearer teacher-token')
      .send({ classId: 'class-1', attendanceDate: '2026-10-05', expectedVersion: 0, idempotencyKey: 'key-1',
        rows: [{ studentId: 'student-1', status: 'ABSENT' }], notificationRecipients: [{ studentId: 'student-1', guardianUserId: 'untrusted-user' }] }).expect(201);
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'attendance' && call[1] === '/internal/v1/attendance/batches');
    expect(JSON.parse(String(downstream?.[2]?.body)).notificationRecipients).toEqual([{ studentId: 'student-1', guardianUserId: 'parent-1' }]);
  });

  it('checks teacher assignment before publishing', async () => {
    const payload = { classId: 'class-1', postType: 'HOMEWORK', title: 'Fractions', body: 'Complete exercise', dueDate: '2026-09-25', audienceType: 'CLASS', idempotencyKey: 'key-1', recipients: [{ studentId: 'student-1', guardianUserId: 'parent-1' }] };
    const response = await request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', 'Bearer teacher-token').send(payload).expect(201);
    expect(response.body.status).toBe('PUBLISHED');
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'content' && call[1] === '/internal/v1/posts');
    expect(JSON.parse(String(downstream?.[2]?.body)).authorMembershipId).toBe('membership-teacher');
  });

  it('rejects a teacher outside the assigned class', async () => {
    await request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', 'Bearer teacher-token').send({ classId: 'class-denied', postType: 'HOMEWORK' }).expect(403);
  });

  it('lists persisted posts for the authenticated teacher membership', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/teacher-posts').set('Authorization', 'Bearer teacher-token').expect(200);
    expect(response.body[0]).toMatchObject({ postType: 'ANNOUNCEMENT', title: 'School closed' });
    expect(serviceClient.request).toHaveBeenCalledWith('read', expect.stringContaining('authorMembershipId=membership-teacher'));
  });

  it('does not expose the teacher publishing feed to a parent', async () => {
    await request(app.getHttpServer()).get('/api/v1/teacher-posts').set('Authorization', 'Bearer parent-token').expect(403);
  });

  it('publishes an announcement after resolving recipients on the server', async () => {
    const payload = { classId: 'class-1', postType: 'ANNOUNCEMENT', title: 'School closed', body: 'School will be closed tomorrow.', audienceType: 'CLASS', idempotencyKey: 'key-2' };
    await request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', 'Bearer teacher-token').send(payload).expect(201);
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'content' && call[1] === '/internal/v1/posts');
    const forwarded = JSON.parse(String(downstream?.[2]?.body)) as { recipients: Array<{ studentId: string }>; authorMembershipId: string };
    expect(forwarded.recipients).toEqual([{ studentId: 'student-1', guardianUserId: 'parent-1', snapshot: {} }]);
    expect(forwarded.authorMembershipId).toBe('membership-teacher');
  });

  it('carries one correlation ID into the post outbox request without trusting a client school ID', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/posts')
      .set('Authorization', 'Bearer teacher-token').set('x-correlation-id', 'trace-post-123')
      .send({ classId: 'class-1', postType: 'ANNOUNCEMENT', title: 'Reminder', body: 'Bring a notebook',
        audienceType: 'CLASS', idempotencyKey: 'trace-key', schoolId: 'other-school' }).expect(201);
    expect(response.headers['x-correlation-id']).toBe('trace-post-123');
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'content' && call[1] === '/internal/v1/posts');
    expect(JSON.parse(String(downstream?.[2]?.body))).toMatchObject({ schoolId: 'school-1', correlationId: 'trace-post-123' });
  });

  it('requires the teacher role and current school context to complete an upload', async () => {
    await request(app.getHttpServer()).post('/api/v1/files/uploads/upload-1/complete').set('Authorization', 'Bearer parent-token').expect(403);
    await request(app.getHttpServer()).post('/api/v1/files/uploads/upload-1/complete').set('Authorization', 'Bearer teacher-token').expect(201);
    const completion = serviceClient.request.mock.calls.find((call) => call[0] === 'files' && call[1] === '/internal/v1/uploads/upload-1/complete');
    expect(JSON.parse(String(completion?.[2]?.body))).toEqual({ actorUserId: 'teacher-1', schoolId: 'school-1' });
  });

  it('lets a teacher create a correction revision for their own post', async () => {
    const payload = { expectedRevisionNumber: 1, title: 'Corrected notice', body: 'Updated details', changeKind: 'MATERIAL' };
    const response = await request(app.getHttpServer()).post('/api/v1/posts/post-owned/revisions').set('Authorization', 'Bearer teacher-token').send(payload).expect(201);
    expect(response.body).toMatchObject({ revisionNumber: 2, status: 'UPDATED' });
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'content' && call[1] === '/internal/v1/posts/post-owned/revisions');
    expect(JSON.parse(String(downstream?.[2]?.body))).toMatchObject({
      expectedRevisionNumber: 1,
      authorMembershipId: 'membership-teacher',
      schoolId: 'school-1',
    });
  });

  it('prevents a teacher from editing another teacher’s post', async () => {
    await request(app.getHttpServer()).post('/api/v1/posts/post-other/revisions').set('Authorization', 'Bearer teacher-token').send({ expectedRevisionNumber: 1, title: 'Changed', body: 'Changed' }).expect(403);
    expect(serviceClient.request.mock.calls.some((call) => call[1] === '/internal/v1/posts/post-other/revisions')).toBe(false);
  });

  it('does not expose post correction to a parent', async () => {
    await request(app.getHttpServer()).post('/api/v1/posts/post-owned/revisions').set('Authorization', 'Bearer parent-token').send({ expectedRevisionNumber: 1, title: 'Changed', body: 'Changed' }).expect(403);
  });

  it('lets only the platform owner create a school and its first administrator', async () => {
    const payload = { schoolCode: 'NEW1', displayName: 'New School', timezone: 'Asia/Riyadh', adminDisplayName: 'New Admin', adminPhoneE164: '+919800000001' };
    const response = await request(app.getHttpServer()).post('/api/v1/admin/schools').set('Authorization', 'Bearer owner-token').send(payload).expect(201);
    expect(response.body.school.id).toBe('school-created');
    expect(response.body.administrator.role).toBe('SCHOOL_ADMIN');
    const provision = serviceClient.request.mock.calls.find((call) => call[0] === 'identity' && call[1] === '/internal/v1/provisioning/accounts');
    expect(JSON.parse(String(provision?.[2]?.body))).toMatchObject({ schoolId: 'school-created', role: 'SCHOOL_ADMIN' });
    await request(app.getHttpServer()).post('/api/v1/admin/schools').set('Authorization', 'Bearer parent-token').send(payload).expect(403);
  });

  it('locks class creation to the school administrator school context', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/classes').set('Authorization', 'Bearer admin-token').send({ classCode: 'G5A', displayName: 'Grade 5A', academicYear: '2026-2027', schoolId: 'school-other' }).expect(201);
    expect(serviceClient.request).toHaveBeenCalledWith('school', '/internal/v1/schools/school-1/classes', expect.objectContaining({ method: 'POST' }));
  });

  it('lets a school administrator provision a teacher with an assignment', async () => {
    const payload = { displayName: 'Teacher Two', phoneE164: '+919800000002', classId: 'class-1', subjectCode: 'MATH', subjectName: 'Mathematics', canPublishResults: false, canPublishAnnouncements: true, canRecordAttendance: true, schoolId: 'school-other' };
    const response = await request(app.getHttpServer()).post('/api/v1/admin/teachers').set('Authorization', 'Bearer admin-token').send(payload).expect(201);
    expect(response.body.teacher).toMatchObject({ role: 'TEACHER', membershipId: 'new-teacher-membership' });
    const provision = serviceClient.request.mock.calls.find((call) => call[0] === 'identity' && call[1] === '/internal/v1/provisioning/accounts');
    expect(JSON.parse(String(provision?.[2]?.body))).toMatchObject({ schoolId: 'school-1', role: 'TEACHER' });
    expect(serviceClient.request).toHaveBeenCalledWith('school', '/internal/v1/schools/school-1/teacher-assignments', expect.objectContaining({ method: 'POST' }));
  });

  it('previews school-scoped result rows and publishes only to the matched student guardians', async () => {
    const row = { admissionNumber: 'a-001', examName: 'Term 1', subjectName: 'Mathematics', marksObtained: 82, maxMarks: 100, grade: 'A' };
    const preview = await request(app.getHttpServer()).post('/api/v1/admin/results/import-preview')
      .set('Authorization', 'Bearer admin-token').send({ rows: [row] }).expect(201);
    expect(preview.body).toMatchObject({ valid: true, rows: [{ status: 'READY', studentId: 'student-1', classId: 'class-1', guardianCount: 1 }] });

    const response = await request(app.getHttpServer()).post('/api/v1/admin/results/import-publish')
      .set('Authorization', 'Bearer admin-token').send({ batchId: '123e4567-e89b-42d3-a456-426614174000', rows: [row] }).expect(201);
    expect(response.body.published).toBe(1);
    const downstream = serviceClient.request.mock.calls.find((call) => call[0] === 'content' && call[1] === '/internal/v1/results/bulk-publish');
    const payload = JSON.parse(String(downstream?.[2]?.body));
    expect(payload).toMatchObject({ schoolId: 'school-1', authorMembershipId: 'membership-admin', rows: [{ studentId: 'student-1', recipients: [{ studentId: 'student-1', guardianUserId: 'parent-1' }] }] });
    await request(app.getHttpServer()).post('/api/v1/admin/results/import-publish')
      .set('Authorization', 'Bearer parent-token').send({ batchId: '123e4567-e89b-42d3-a456-426614174001', rows: [row] }).expect(403);
  });

  it('rejects a teacher assignment to a class outside the administrator school before creating the identity', async () => {
    const payload = { displayName: 'Teacher Two', phoneE164: '+919800000002', classId: 'class-from-another-school', subjectCode: 'MATH', subjectName: 'Mathematics' };
    await request(app.getHttpServer()).post('/api/v1/admin/teachers').set('Authorization', 'Bearer admin-token').send(payload).expect(400);
    expect(serviceClient.request.mock.calls.some((call) => call[0] === 'identity' && call[1] === '/internal/v1/provisioning/accounts')).toBe(false);
  });
});
