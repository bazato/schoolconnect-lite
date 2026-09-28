import { describe, expect, it } from 'vitest';
import { resolveAssignment, routeFromDeepLink } from './workflows';
import type { ApiTeachingAssignment } from './api';

describe('role-aware workflow routing', () => {
  it('selects the requested class and subject without falling back to another class', () => {
    const scope = [{ classId: 'A', subjectCode: 'MATH' }, { classId: 'B', subjectCode: 'ENG' }, { classId: 'A', subjectCode: 'SCI' }] as ApiTeachingAssignment[];
    expect(resolveAssignment(scope, 'A', 'SCI')).toBe(scope[2]);
    expect(resolveAssignment(scope, 'missing')).toBeUndefined();
    expect(resolveAssignment(scope, 'A', 'missing')).toBeUndefined();
  });
  it('keeps a notification child context and rejects unrelated URLs', () => {
    const id = '30000000-0000-4000-8000-000000000001';
    expect(routeFromDeepLink(`schoolconnect://posts/${id}?studentId=child-b`)).toEqual({ name: 'post-detail', postId: id, studentId: 'child-b' });
    expect(routeFromDeepLink(`schoolconnect://attendance/${id}`)).toEqual({ name: 'absence', eventId: id });
    expect(routeFromDeepLink(`https://example.com/posts/${id}`)).toBeNull();
    expect(routeFromDeepLink('schoolconnect://posts/invalid')).toBeNull();
  });
});
