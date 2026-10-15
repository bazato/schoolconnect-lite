import { describe, expect, it } from 'vitest';
import { invalidScopeInput, safeIdentifier, validSessionPrincipal } from './security-boundary';

describe('scope identifier transport validation', () => {
  it('accepts UUIDs and existing fixture identifiers, but never URL syntax', () => {
    for (const id of ['123e4567-e89b-42d3-a456-426614174000','student-1','student_1']) expect(safeIdentifier(id)).toBe(true);
    for (const id of ['',null,42,['student-1'],'id/other','id?schoolId=other','id&schoolId=other','id%26schoolId','id\n','a'.repeat(129)]) expect(safeIdentifier(id)).toBe(false);
  });
  it('supports an unscoped owner session, not an unscoped school role', () => {
    const owner = {userId:'owner',membershipId:'membership',sessionId:'session',role:'PLATFORM_OWNER',schoolId:null,displayName:'Owner'};
    expect(validSessionPrincipal(owner)).toBe(true);
    expect(validSessionPrincipal({...owner,role:'TEACHER'})).toBe(false);
  });
  it('does not constrain free text such as questions, notes or names', () => {
    expect(invalidScopeInput({}, {}, {question:'What about Grade 3 & Grade 4?',displayName:'A/B',reason:'Doctor: <checkup>'})).toBeUndefined();
  });
  it('rejects structured scope values without rejecting optional null IDs', () => {
    expect(invalidScopeInput({}, {schoolId:['first','second']}, {})).toBe('schoolId');
    expect(invalidScopeInput({}, {}, {classId:{id:'first'}})).toBe('classId');
    expect(invalidScopeInput({}, {}, {schoolId:null})).toBeUndefined();
    expect(invalidScopeInput({}, {attendanceDate:'2026-10-14&schoolId=other'}, {})).toBe('attendanceDate');
  });
});
