import { Test } from '@nestjs/testing';
import { BadGatewayException, NotFoundException, UnauthorizedException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule, ServiceClient } from './app.module';
import { currentRequestContext, requestContextMiddleware } from './request-context';

const parent = { userId:'parent-1', displayName:'Parent', membershipId:'parent-membership', schoolId:'school-1', role:'PARENT', sessionId:'parent-session' };
const teacher = { ...parent, userId:'teacher-1', membershipId:'teacher-membership', role:'TEACHER' };
const admin = { ...parent, userId:'admin-1', membershipId:'admin-membership', role:'SCHOOL_ADMIN' };

// HTTP gateway contract tests: Identity, Authorization and resource stores are
// simulated, not a substitute for PostgreSQL-backed end-to-end isolation tests.
describe('fail-closed gateway tenant boundaries', () => {
  let app: INestApplication;
  let principal: unknown;
  let routeDecision: unknown;
  let resourceDecision: unknown;
  let school: unknown;
  const clients = { request:vi.fn() };
  beforeEach(async () => {
    principal = parent; routeDecision = { allowed:true }; resourceDecision = { allowed:true }; school = { active:true };
    clients.request.mockReset();
    clients.request.mockImplementation(async (service:string, path:string, init?:RequestInit) => {
      if (service === 'identity') return principal;
      if (service === 'school' && path === '/internal/v1/schools/school-1') return school;
      if (service === 'authorization') return path.endsWith('/route') ? routeDecision : resourceDecision;
      if (service === 'school' && path.endsWith('/audience-recipients?audienceType=CLASS')) return [{ studentId:'child-1',guardianUserId:'parent-1',snapshot:{} }];
      if (service === 'school' && path.endsWith('/roster')) return [{ id:'child-1' }];
      if (service === 'content' && path.includes('/files/')) return { postId:'post-1', authorMembershipId:'teacher-membership', studentId:'child-1', privacyClassification:'STUDENT_PRIVATE' };
      if (service === 'content' && path.includes('/posts/foreign-post')) throw new NotFoundException();
      if (service === 'school' && init?.method === 'PATCH') throw new NotFoundException();
      return [];
    });
    const module = await Test.createTestingModule({ imports:[AppModule] }).overrideProvider(ServiceClient).useValue(clients).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1'); app.use(requestContextMiddleware); await app.init();
  });
  afterEach(async () => { await app?.close(); });
  const resourceCalls = () => clients.request.mock.calls.filter(([service]) => ['content','attendance','read','files','fees'].includes(service));

  it.each([null, {}, { allowed:false }, { allowed:'true' }, { allowed:'false' }, { allowed:1 }])('rejects a malformed or negative route decision: %j', async (decision) => {
    routeDecision = decision;
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1').set('Authorization','Bearer test').expect(403);
    expect(resourceCalls()).toEqual([]);
  });
  it.each([null, {}, { allowed:false }, { allowed:'true' }, { allowed:'false' }, { allowed:1 }])('rejects a malformed or negative resource decision: %j', async (decision) => {
    resourceDecision = decision;
    await request(app.getHttpServer()).get('/api/v1/timeline/child-foreign').set('Authorization','Bearer test').expect(403);
    expect(resourceCalls()).toEqual([]);
  });
  it.each([null, {}, { ...parent,schoolId:'school-2?schoolId=school-1' }, { ...parent,role:'OWNER' }, { ...parent,role:['PARENT'] }, { ...parent,sessionId:'' }, { ...parent,schoolId:null }])('rejects invalid Identity context before querying School: %j', async (value) => {
    principal = value;
    await request(app.getHttpServer()).get('/api/v1/me/children').set('Authorization','Bearer test').expect(401);
    expect(clients.request.mock.calls).toHaveLength(1);
  });
  it.each([null, {}, { active:false }, { active:'true' }])('rejects inactive or malformed school state: %j', async (value) => {
    school = value;
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1').set('Authorization','Bearer test').expect(403);
    expect(resourceCalls()).toEqual([]);
  });
  it('ignores forged tenant headers and query scope, using the session in policy and reads', async () => {
    let trace: unknown;
    const original = clients.request.getMockImplementation()!;
    clients.request.mockImplementation(async (service:string,path:string,init?:RequestInit) => {
      if (service === 'read') trace = { ...currentRequestContext() };
      return original(service,path,init);
    });
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1?schoolId=school-2&guardianUserId=attacker')
      .set('Authorization','Bearer test').set('x-schoolconnect-school-id','school-2').set('x-schoolconnect-user-id','attacker')
      .set('x-schoolconnect-role','PLATFORM_OWNER').expect(200);
    expect(trace).toMatchObject({ schoolId:'school-1',userId:'parent-1',membershipId:'parent-membership',role:'PARENT' });
    const policy = clients.request.mock.calls.find((call) => call[1] === '/internal/v1/decisions');
    expect(JSON.parse(String(policy?.[2]?.body))).toMatchObject({ principal:parent,studentId:'child-1' });
    expect(clients.request.mock.calls.find(([service]) => service === 'read')?.[1]).toBe('/internal/v1/timeline?schoolId=school-1&guardianUserId=parent-1&studentId=child-1&limit=50');
  });
  it('denies immediately after a guardian relationship is revoked; no cached grant', async () => {
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1').set('Authorization','Bearer test').expect(200);
    clients.request.mockClear(); resourceDecision = { allowed:false };
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1').set('Authorization','Bearer test').expect(403);
    expect(resourceCalls()).toEqual([]);
  });
  it('keeps simultaneous tenant requests isolated in server request context', async () => {
    const original = clients.request.getMockImplementation()!;
    const observed: Array<{path:string; schoolId?:string; userId?:string}> = [];
    clients.request.mockImplementation(async (service:string,path:string,init?:RequestInit) => {
      if (service === 'identity') {
        const token = JSON.parse(String(init?.body)).accessToken;
        return token === 'school-2' ? {...parent,schoolId:'school-2',userId:'parent-2',membershipId:'parent-2-membership'} : parent;
      }
      if (service === 'school') return {active:true};
      if (service === 'read') {
        // Allow another HTTP request to interleave before reading the async context.
        await new Promise((resolve) => setTimeout(resolve,5));
        observed.push({path,schoolId:currentRequestContext()?.schoolId,userId:currentRequestContext()?.userId});
        return [];
      }
      return original(service,path,init);
    });
    await Promise.all(['school-1','school-2'].map((token) => request(app.getHttpServer()).get('/api/v1/timeline/child-1')
      .set('Authorization',`Bearer ${token}`).expect(200)));
    expect(observed).toHaveLength(2);
    for (const entry of observed) {
      const query = new URL(entry.path,'http://read').searchParams;
      expect(entry.schoolId).toBe(query.get('schoolId'));
      expect(entry.userId).toBe(query.get('guardianUserId'));
    }
    expect(new Set(observed.map((entry) => entry.schoolId))).toEqual(new Set(['school-1','school-2']));
  });
  it('blocks publishing and attendance after assignment revocation, including foreign classes', async () => {
    principal = teacher; resourceDecision = { allowed:false };
    for (const path of ['posts','attendance/batches']) {
      await request(app.getHttpServer()).post(`/api/v1/${path}`).set('Authorization','Bearer test')
        .send({ classId:'foreign-class',schoolId:'school-2',postType:'ANNOUNCEMENT',title:'Test',rows:[{studentId:'foreign-child',status:'PRESENT'}] }).expect(403);
    }
    expect(resourceCalls()).toEqual([]);
  });
  it('checks guardian access before fetching post details or generating a private file URL', async () => {
    resourceDecision = { allowed:false };
    await request(app.getHttpServer()).post('/api/v1/files/file-1/access').set('Authorization','Bearer test').send({ studentId:'child-1' }).expect(403);
    expect(clients.request.mock.calls.some(([service,path]) => service === 'content' && path.includes('/posts/'))).toBe(false);
    expect(clients.request.mock.calls.some(([service]) => service === 'files')).toBe(false);
  });
  it('scopes administrator student edits to their own school even with forged body scope', async () => {
    principal = admin;
    await request(app.getHttpServer()).patch('/api/v1/admin/students/foreign-child').set('Authorization','Bearer test')
      .send({ schoolId:'school-2',displayName:'Renamed' }).expect(404);
    expect(clients.request.mock.calls.find((call) => call[2]?.method === 'PATCH')?.[1]).toBe('/internal/v1/schools/school-1/students/foreign-child');
  });
  it('does not retry a foreign-school post lookup without its tenant filter', async () => {
    principal = teacher;
    await request(app.getHttpServer()).get('/api/v1/posts/foreign-post').set('Authorization','Bearer test').expect(404);
    expect(resourceCalls()).toHaveLength(1);
    expect(resourceCalls()[0]?.[1]).toBe('/internal/v1/posts/foreign-post?schoolId=school-1');
  });
  it('rejects a revoked session before authorization or resource calls', async () => {
    clients.request.mockRejectedValue(new UnauthorizedException());
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1').set('Authorization','Bearer test').expect(401);
    expect(clients.request.mock.calls).toHaveLength(1);
  });
  it.each(['school','authorization'])('fails closed when %s is unavailable', async (unavailable) => {
    const original = clients.request.getMockImplementation()!;
    clients.request.mockImplementation((service:string,path:string,init?:RequestInit) => service === unavailable
      ? Promise.reject(new BadGatewayException({code:'SERVICE_UNAVAILABLE'})) : original(service,path,init));
    await request(app.getHttpServer()).get('/api/v1/timeline/child-1').set('Authorization','Bearer test').expect(502);
    expect(resourceCalls()).toEqual([]);
  });
  it.each(['/api/v1/timeline/child-1%3FschoolId%3Dschool-2','/api/v1/posts/post-1%26schoolId%3Dschool-2?studentId=child-1',
    '/api/v1/attendance/current?classId=class-1%26schoolId%3Dschool-2&attendanceDate=2026-10-14',
    '/api/v1/attendance/current?classId=class-1&classId=class-2&attendanceDate=2026-10-14',
    '/api/v1/attendance/current?classId=class-1&attendanceDate=2026-10-14%26schoolId%3Dschool-2'])('rejects URL delimiter/duplicate identifier injection: %s', async (path) => {
    await request(app.getHttpServer()).get(path).set('Authorization','Bearer test').expect(400);
    expect(clients.request).not.toHaveBeenCalled();
  });
});
