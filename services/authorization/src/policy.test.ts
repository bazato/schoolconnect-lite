import { describe, expect, it, vi } from 'vitest';
import { PolicyEngine, RoutePolicy, type Principal } from './policy';

const teacher: Principal = { userId: 'u1', membershipId: 'm1', schoolId: 's1', role: 'TEACHER' };
const parent: Principal = { userId: 'u2', membershipId: 'm2', schoolId: 's1', role: 'PARENT' };

describe('resource policy', () => {
  it.each([null, {}, { allowed:'true' }, { allowed:1 }, { allowed:false }])('never approves malformed School relationship facts: %j', async (fact) => {
    const policy = new PolicyEngine(vi.fn().mockResolvedValue(fact));
    expect(await policy.decide({ action:'GUARDIAN_CHILD',principal:parent,studentId:'st1' })).toEqual({ allowed:false,reason:'RELATIONSHIP_DENIED' });
  });
  it('uses school, actor and resource together; a known ID in another school is not a grant', async () => {
    const relationships = vi.fn(async (path:string) => {
      const query = new URL(path,'http://school').searchParams;
      return { allowed:query.get('schoolId') === 's1' && query.get('guardianUserId') === 'u2' && query.get('studentId') === 'st1' };
    });
    const policy = new PolicyEngine(relationships);
    expect((await policy.decide({ action:'GUARDIAN_CHILD',principal:parent,studentId:'st1' })).allowed).toBe(true);
    expect((await policy.decide({ action:'GUARDIAN_CHILD',principal:{...parent,schoolId:'s2'},studentId:'st1' })).allowed).toBe(false);
    expect((await policy.decide({ action:'GUARDIAN_CHILD',principal:parent,studentId:'foreign-child' })).allowed).toBe(false);
  });
  it('encodes malicious resource identifiers as one School fact parameter', async () => {
    const relationships = vi.fn().mockResolvedValue({allowed:false});
    await new PolicyEngine(relationships).decide({action:'GUARDIAN_CHILD',principal:parent,studentId:'st1&schoolId=s2'});
    const query = new URL(relationships.mock.calls[0]![0],'http://school').searchParams;
    expect(query.getAll('schoolId')).toEqual(['s1']);
    expect(query.get('studentId')).toBe('st1&schoolId=s2');
  });
  it('does not cache relationship grants across revocation', async () => {
    const facts = vi.fn().mockResolvedValueOnce({allowed:true}).mockResolvedValueOnce({allowed:false});
    const policy = new PolicyEngine(facts);
    const input = {action:'TEACHER_CLASS' as const,principal:teacher,classId:'c1',capability:'ATTENDANCE' as const};
    expect((await policy.decide(input)).allowed).toBe(true);
    expect((await policy.decide(input)).allowed).toBe(false);
    expect(facts).toHaveBeenCalledTimes(2);
  });
  it('propagates fact service failures without returning an approval', async () => {
    const policy = new PolicyEngine(vi.fn().mockRejectedValue(new Error('School unavailable')));
    await expect(policy.decide({action:'GUARDIAN_CHILD',principal:parent,studentId:'st1'})).rejects.toThrow('School unavailable');
  });
  it('denies wrong roles without asking School', async () => {
    const relationships = vi.fn().mockResolvedValue({ allowed: true });
    const policy = new PolicyEngine(relationships);
    expect(await policy.decide({ action: 'GUARDIAN_CHILD', principal: teacher, studentId: 'st1' })).toEqual({ allowed: false, reason: 'ROLE_OR_SCHOOL_DENIED' });
    expect(relationships).not.toHaveBeenCalled();
  });
  it('uses live tenant-scoped guardian and teacher relationships', async () => {
    const relationships = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    const policy = new PolicyEngine(relationships);
    expect((await policy.decide({ action: 'GUARDIAN_CHILD', principal: parent, studentId: 'st1' })).allowed).toBe(true);
    expect(relationships).toHaveBeenCalledWith('/internal/v1/authorization/guardian?schoolId=s1&guardianUserId=u2&studentId=st1');
    expect((await policy.decide({ action: 'TEACHER_CLASS', principal: teacher, classId: 'c1', capability: 'RESULTS' })).allowed).toBe(false);
    expect(relationships).toHaveBeenCalledWith('/internal/v1/authorization/teacher?schoolId=s1&membershipId=m1&classId=c1&capability=RESULTS');
  });
  it('allows configured role changes but never skips School relationship checks', async () => {
    const relationships = vi.fn().mockResolvedValue({ allowed: false });
    const policy = new PolicyEngine(relationships, '{"TEACHER_CLASS":["SCHOOL_ADMIN"],"GUARDIAN_CHILD":["PARENT"]}');
    const admin: Principal = { ...teacher, role: 'SCHOOL_ADMIN' };
    expect((await policy.decide({ action: 'TEACHER_CLASS', principal: admin, classId: 'c1', capability: 'ATTENDANCE' })).allowed).toBe(false);
  });
});

describe('route policy', () => {
  const routes = new RoutePolicy();
  it('keeps event recovery operations platform-owner-only', () => {
    for (const [method,path] of [['GET','/api/v1/admin/operations/events'],['POST','/api/v1/admin/operations/events/read/failure-1/retry']]) {
      expect(routes.decide(method!,path!,'PLATFORM_OWNER').allowed).toBe(true);
      for (const role of ['SCHOOL_ADMIN','TEACHER','PARENT'] as const) expect(routes.decide(method!,path!,role).allowed).toBe(false);
    }
  });
  it('keeps fees administrator-only in the central replaceable route policy', () => {
    for(const action of ['import-preview','import-commit','search']) {
      const path=`/api/v1/admin/fees/${action}`;
      expect(routes.decide('POST',path,'SCHOOL_ADMIN').allowed).toBe(true);
      for(const role of ['PLATFORM_OWNER','TEACHER','PARENT'] as const) expect(routes.decide('POST',path,role).allowed).toBe(false);
    }
  });
  it('allows only the owner to provision schools', () => {
    expect(routes.decide('POST','/api/v1/admin/schools','PLATFORM_OWNER').allowed).toBe(true);
    expect(routes.decide('POST','/api/v1/admin/schools','SCHOOL_ADMIN').allowed).toBe(false);
  });
  it('separates teacher and parent feeds', () => {
    expect(routes.decide('GET','/api/v1/timeline/student-1','PARENT').allowed).toBe(true);
    expect(routes.decide('GET','/api/v1/timeline/student-1','TEACHER').allowed).toBe(false);
    expect(routes.decide('POST','/api/v1/posts','TEACHER').allowed).toBe(true);
    expect(routes.decide('POST','/api/v1/posts','PARENT').allowed).toBe(false);
  });
  it('denies routes missing from policy and supports configuration replacement', () => {
    expect(routes.decide('GET','/api/v1/unknown','PLATFORM_OWNER')).toEqual({ allowed: false, reason: 'ROUTE_UNCONFIGURED' });
    const custom = new RoutePolicy('[{"methods":["GET"],"pattern":"^/api/v1/custom$","roles":["SCHOOL_ADMIN"]}]');
    expect(custom.decide('GET','/api/v1/custom','SCHOOL_ADMIN').allowed).toBe(true);
    expect(custom.decide('GET','/api/v1/custom','PARENT').allowed).toBe(false);
  });
});
