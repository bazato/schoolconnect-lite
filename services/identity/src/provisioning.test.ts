import { describe, expect, it } from 'vitest';
import { parentInvitationStatus } from './provisioning';

describe('parent invitation reuse', () => {
  it('does not issue another invitation to an activated parent', () => {
    expect(parentInvitationStatus({ hasAcceptedInvitation: true, hasUnexpiredInvitation: false })).toBe('ALREADY_ACTIVE');
  });

  it('keeps an existing unexpired first-sign-in invitation', () => {
    expect(parentInvitationStatus({ hasAcceptedInvitation: false, hasUnexpiredInvitation: true })).toBe('ALREADY_PENDING');
  });

  it('issues a new invitation when there is no active or pending invite', () => {
    expect(parentInvitationStatus({ hasAcceptedInvitation: false, hasUnexpiredInvitation: false })).toBe('ISSUED');
  });
});
