import { domainEventTypes } from '@schoolconnect/contracts';
import { type EventEnvelope } from '@schoolconnect/eventing';

export type NotificationInput = {
  sourceEventId: string; schoolId: string; recipientUserId: string; studentId?: string;
  notificationType: string; resourceType: string; resourceId: string; title: string; body: string; deepLink: string;
};

function recipients(payload: Record<string, unknown>): Array<{ guardianUserId: string; studentId?: string }> {
  const source = payload.guardians ?? payload.recipients;
  if (!Array.isArray(source)) return [];
  return source.filter((item): item is { guardianUserId: string; studentId?: string } =>
    !!item && typeof item === 'object' && typeof item.guardianUserId === 'string');
}

async function legacyLookup<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: process.env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN } : {}, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`LEGACY_NOTIFICATION_LOOKUP_${response.status}`);
  return response.json() as Promise<T>;
}

export async function applyNotificationEvent(envelope: EventEnvelope, enqueue: (input: NotificationInput, correlationId?: string) => Promise<unknown>): Promise<void> {
  const { event } = envelope;
  const payload = event.payload;
  const schoolId = typeof payload.schoolId === 'string' ? payload.schoolId : '';
  if (!schoolId) return;
  const correlationId = typeof payload.correlationId === 'string' ? payload.correlationId : event.id;
  const write = (input: Omit<NotificationInput, 'sourceEventId' | 'schoolId'>) => enqueue({ ...input, sourceEventId: event.id, schoolId }, correlationId);
  if (event.eventType === domainEventTypes.postPublished || event.eventType === domainEventTypes.postUpdated) {
    let snapshot = payload.notification as { title?: unknown; body?: unknown } | undefined;
    if (!snapshot) snapshot = await legacyLookup<{ title: string; body: string }>(process.env.CONTENT_SERVICE_URL ?? 'http://127.0.0.1:3103', `/internal/v1/posts/${event.aggregateId}?schoolId=${schoolId}`);
    if (typeof snapshot.title !== 'string' || typeof snapshot.body !== 'string') throw new Error('POST_NOTIFICATION_SNAPSHOT_INVALID');
    await Promise.all(recipients(payload).map(({ guardianUserId, studentId }) => studentId ? write({ recipientUserId: guardianUserId, studentId,
      notificationType: event.eventType === domainEventTypes.postUpdated ? 'POST_UPDATED' : 'POST_PUBLISHED', resourceType: 'POST', resourceId: event.aggregateId,
      title: snapshot.title as string, body: (snapshot.body as string).slice(0, 500), deepLink: `schoolconnect://posts/${event.aggregateId}?studentId=${studentId}` }) : Promise.resolve()));
  }
  if (event.eventType === domainEventTypes.studentAbsent || event.eventType === domainEventTypes.attendanceCorrected || event.eventType === domainEventTypes.leaveReviewed) {
    const studentId = String(payload.studentId ?? '');
    if (!studentId) throw new Error('ATTENDANCE_EVENT_STUDENT_REQUIRED');
    let guardians = event.eventType === domainEventTypes.leaveReviewed ? [{ guardianUserId: String(payload.guardianUserId ?? '') }]
      : payload.guardians === undefined ? await legacyLookup<Array<{ guardianUserId: string }>>(process.env.SCHOOL_SERVICE_URL ?? 'http://127.0.0.1:3102', `/internal/v1/schools/${schoolId}/students/${studentId}/guardians`) : recipients(payload);
    guardians = guardians.filter((guardian) => guardian.guardianUserId);
    await Promise.all(guardians.map((guardian) => write({ recipientUserId: guardian.guardianUserId, studentId,
      notificationType: event.eventType === domainEventTypes.studentAbsent ? 'ATTENDANCE_ABSENT' : event.eventType === domainEventTypes.leaveReviewed ? 'LEAVE_REVIEWED' : 'ATTENDANCE_CORRECTED',
      resourceType: 'ATTENDANCE_EVENT', resourceId: String(payload.attendanceEventId ?? event.aggregateId),
      title: event.eventType === domainEventTypes.studentAbsent ? 'Student marked absent' : event.eventType === domainEventTypes.leaveReviewed ? `Leave request ${String(payload.status).toLowerCase()}` : 'Attendance corrected',
      body: event.eventType === domainEventTypes.studentAbsent ? `Attendance for ${String(payload.attendanceDate)}` : event.eventType === domainEventTypes.leaveReviewed ? 'Your school reviewed the leave note.' : `Updated status: ${String(payload.status)}`,
      deepLink: `schoolconnect://attendance/${String(payload.attendanceEventId ?? event.aggregateId)}` })));
  }
}
