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

// Versioned events already emitted by the service-owned transactional outboxes.
// Add a new version when a consumer-visible payload changes incompatibly.
export const domainEventTypes = {
  postPublished: 'content.post-published.v1',
  postScheduled: 'content.post-scheduled.v1',
  postSnapshot: 'content.post-snapshot.v1',
  postUpdated: 'content.post-updated.v1',
  scheduledPostUpdated: 'content.scheduled-post-updated.v1',
  postArchived: 'content.post-archived.v1',
  studentAbsent: 'attendance.student-absent.v1',
  attendanceRecorded: 'attendance.recorded.v1',
  attendanceSnapshot: 'attendance.snapshot.v1',
  attendanceCorrected: 'attendance.corrected.v1',
  attendanceProjectionRebuilt: 'attendance.projection-rebuilt.v1',
  absenceAcknowledged: 'attendance.absence-acknowledged.v1',
  leaveReviewed: 'attendance.leave-reviewed.v1',
  accountProvisioned: 'identity.account-provisioned.v1',
  membershipUpdated: 'identity.membership-updated.v1',
  membershipRevoked: 'identity.membership-revoked.v1',
  invitationReissued: 'identity.invitation-reissued.v1',
  fileUploadCompleted: 'files.upload-completed.v1',
  schoolCreated: 'school.created.v1',
  schoolUpdated: 'school.updated.v1',
  classUpserted: 'school.class-upserted.v1',
  academicYearRolledOver: 'school.academic-year-rolled-over.v1',
  teacherAssigned: 'school.teacher-assigned.v1',
  teacherAssignmentUpdated: 'school.teacher-assignment-updated.v1',
  teacherAssignmentsRevoked: 'school.teacher-assignments-revoked.v1',
  guardianLinked: 'school.guardian-linked.v1',
  guardianLinkUpdated: 'school.guardian-link-updated.v1',
  guardianLinksRevoked: 'school.guardian-links-revoked.v1',
  studentUpdated: 'school.student-updated.v1',
  configurationUpdated: 'school.configuration-updated.v1',
  roleSwitched: 'identity.role-switched.v1',
  notificationCreated: 'notifications.created.v1',
  notificationRead: 'notifications.read.v1',
} as const;

export type DomainEventType = typeof domainEventTypes[keyof typeof domainEventTypes];

export const serviceHeaders = {
  userId: 'x-schoolconnect-user-id',
  membershipId: 'x-schoolconnect-membership-id',
  schoolId: 'x-schoolconnect-school-id',
  role: 'x-schoolconnect-role',
  correlationId: 'x-correlation-id',
} as const;
