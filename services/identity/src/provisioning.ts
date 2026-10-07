export type ParentInvitationStatus = 'ISSUED' | 'ALREADY_PENDING' | 'ALREADY_ACTIVE';

export function parentInvitationStatus(input: {
  hasAcceptedInvitation: boolean;
  hasUnexpiredInvitation: boolean;
}): ParentInvitationStatus {
  if (input.hasAcceptedInvitation) return 'ALREADY_ACTIVE';
  if (input.hasUnexpiredInvitation) return 'ALREADY_PENDING';
  return 'ISSUED';
}
