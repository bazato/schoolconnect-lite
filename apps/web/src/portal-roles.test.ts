import { describe, expect, it } from 'vitest';
import { portalMemberships } from './portal-roles';

describe('administration role choices', () => {
  it('keeps school admin and owner access, while parent and teacher roles remain in mobile', () => {
    expect(portalMemberships([
      { id: 'admin', schoolId: 'one', role: 'SCHOOL_ADMIN' },
      { id: 'parent', schoolId: 'one', role: 'PARENT' },
      { id: 'teacher', schoolId: 'one', role: 'TEACHER' },
      { id: 'owner', schoolId: null, role: 'PLATFORM_OWNER' },
    ]).map((item) => item.id)).toEqual(['admin', 'owner']);
  });
});
