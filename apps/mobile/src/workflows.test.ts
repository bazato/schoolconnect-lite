import { describe, expect, it } from 'vitest';
import { assignmentsForAction, mapApiChildren, resolveAssignment, rosterContextKey, routeFromDeepLink, teacherDraftKey } from './workflows';
import type { ApiChild, ApiTeachingAssignment } from './api';

describe('role-aware workflow routing', () => {
  it('offers only assignments authorized for each action without restricting homework', () => {
    const scope = [
      { assignmentId: 'a', classId: 'A', canPublishResults: false, canPublishAnnouncements: true, canRecordAttendance: true },
      { assignmentId: 'b', classId: 'B', canPublishResults: true, canPublishAnnouncements: false, canRecordAttendance: false },
    ] as ApiTeachingAssignment[];
    expect(assignmentsForAction(scope, 'HOMEWORK')).toEqual(scope);
    expect(assignmentsForAction(scope, 'ANNOUNCEMENT')).toEqual([scope[0]]);
    expect(assignmentsForAction(scope, 'RESULT')).toEqual([scope[1]]);
    expect(assignmentsForAction(scope, 'ATTENDANCE')).toEqual([scope[0]]);
    expect(assignmentsForAction(scope, 'FOLLOW_UPS')).toEqual([scope[0]]);
    expect(assignmentsForAction([], 'HOMEWORK')).toEqual([]);
  });
  it('invalidates an attendance roster when either its class or date changes', () => {
    expect(rosterContextKey('A', '2026-10-13')).not.toBe(rosterContextKey('B', '2026-10-13'));
    expect(rosterContextKey('A', '2026-10-13')).not.toBe(rosterContextKey('A', '2026-10-14'));
  });
  it('keeps class/subject drafts, private attachments and student selection in separate storage keys', () => {
    const first = teacherDraftKey('teacher', 'membership', 'RESULT', 'assignment-a');
    expect(first).toBe('schoolconnect:draft:teacher:membership:assignment-a:RESULT');
    expect(first).not.toBe(teacherDraftKey('teacher', 'membership', 'RESULT', 'assignment-b'));
    expect(first).not.toBe(teacherDraftKey('teacher', 'other-school-membership', 'RESULT', 'assignment-a'));
    expect(first).not.toBe(teacherDraftKey('teacher', 'membership', 'HOMEWORK', 'assignment-a'));
    expect(teacherDraftKey('teacher', 'membership', 'RESULT', 'assignment-a', { id: 'post-a', revisionNumber: 1 })).toBe(teacherDraftKey('teacher', 'membership', 'RESULT', 'assignment-b', { id: 'post-a', revisionNumber: 1 }));
  });
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
    expect(routeFromDeepLink(`schoolconnect://leave-applications/${id}`)).toEqual({name:'leave-applications',contextId:id});
    expect(routeFromDeepLink(`schoolconnect://timetable/${id}`)).toEqual({name:'timetable',contextId:id});
    expect(routeFromDeepLink(`https://example.com/posts/${id}`)).toBeNull();
    expect(routeFromDeepLink('schoolconnect://posts/invalid')).toBeNull();
  });
  it('keeps every child returned for one parent in the mobile child switcher', () => {
    const items = [
      { id: 'student-a', displayName: 'Ava Parent', admissionNumber: 'A-1', classId: 'class-a', className: 'Grade 1', schoolName: 'School One' },
      { id: 'student-b', displayName: 'Ben Parent', admissionNumber: 'B-1', classId: 'class-b', className: 'Grade 3', schoolName: 'School One' },
    ] as ApiChild[];
    expect(mapApiChildren(items).map((child) => child.id)).toEqual(['student-a', 'student-b']);
  });
});
