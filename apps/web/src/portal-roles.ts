import type { Membership } from './api';

export function portalMemberships(memberships: Membership[]) {
  return memberships.filter((membership) => ['PLATFORM_OWNER', 'SCHOOL_ADMIN'].includes(membership.role));
}
