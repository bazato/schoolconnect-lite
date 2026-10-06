import { domainEventTypes } from '@schoolconnect/contracts';
import type { EventEnvelope } from '@schoolconnect/eventing';

export type AuditInput = { sourceEventId: string; schoolId: string; actorUserId?: string; actorMembershipId?: string;
  action: string; resourceType: string; resourceId: string; outcome: 'SUCCEEDED'; correlationId: string;
  metadata: Record<string, unknown>; occurredAt: string };

export function auditFromEvent({ event }: EventEnvelope): AuditInput | null {
  if (event.eventType === domainEventTypes.postSnapshot || event.eventType === domainEventTypes.attendanceSnapshot) return null;
  const payload = event.payload;
  const schoolId = typeof payload.schoolId === 'string' ? payload.schoolId :
    event.eventType.startsWith('identity.') ? '00000000-0000-0000-0000-000000000000' : '';
  if (!schoolId) return null;
  const resourceType = event.eventType.startsWith('identity.') ? 'MEMBERSHIP' : event.eventType.startsWith('content.') ? 'POST' :
    event.eventType.startsWith('notifications.') ? 'NOTIFICATION' : event.eventType.startsWith('files.') ? 'FILE' :
      event.eventType === domainEventTypes.attendanceProjectionRebuilt ? 'ATTENDANCE_PROJECTION' :
        [domainEventTypes.schoolCreated, domainEventTypes.schoolUpdated, domainEventTypes.academicYearRolledOver].includes(event.eventType as typeof domainEventTypes.schoolCreated) ? 'SCHOOL' :
          event.eventType === domainEventTypes.configurationUpdated ? 'SCHOOL_CONFIGURATION' :
            event.eventType === domainEventTypes.classUpserted ? 'CLASS' :
              [domainEventTypes.teacherAssigned,domainEventTypes.teacherAssignmentUpdated,domainEventTypes.teacherAssignmentsRevoked].includes(event.eventType as typeof domainEventTypes.teacherAssigned) ? 'TEACHER_ASSIGNMENT' :
                [domainEventTypes.guardianLinked,domainEventTypes.guardianLinkUpdated,domainEventTypes.guardianLinksRevoked,domainEventTypes.studentUpdated].includes(event.eventType as typeof domainEventTypes.guardianLinked) ? 'STUDENT' : 'ATTENDANCE_EVENT';
  return { sourceEventId: event.id, schoolId, actorUserId: typeof payload.actorUserId === 'string' ? payload.actorUserId : undefined,
    actorMembershipId: typeof payload.actorMembershipId === 'string' ? payload.actorMembershipId : undefined,
    action: event.eventType, resourceType, resourceId: event.aggregateId, outcome: 'SUCCEEDED',
    correlationId: typeof payload.correlationId === 'string' ? payload.correlationId : event.id,
    metadata: payload, occurredAt: event.occurredAt };
}
