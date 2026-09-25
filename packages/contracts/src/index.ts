export type Role = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';

export type RequestPrincipal = {
  userId: string;
  membershipId: string;
  schoolId: string | null;
  role: Role;
  correlationId: string;
};

export type DomainEvent<T extends Record<string, unknown> = Record<string, unknown>> = {
  eventId: string;
  eventType: string;
  aggregateId: string;
  schoolId: string;
  occurredAt: string;
  payload: T;
};

export const serviceHeaders = {
  userId: 'x-schoolconnect-user-id',
  membershipId: 'x-schoolconnect-membership-id',
  schoolId: 'x-schoolconnect-school-id',
  role: 'x-schoolconnect-role',
  correlationId: 'x-correlation-id',
} as const;
