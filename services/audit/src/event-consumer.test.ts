import { describe, expect, it } from 'vitest';
import { auditFromEvent } from './event-consumer';

describe('audit event mapping', () => {
  it('keeps the source ID and request correlation', () => {
    expect(auditFromEvent({ source: 'school', event: { id: 'event-1', eventType: 'school.student-updated.v1', aggregateId: 'student-1', occurredAt: '2026-10-06T00:00:00Z',
      payload: { schoolId: 'school-1', actorUserId: 'admin-1', correlationId: 'trace-1' } } })).toMatchObject({ sourceEventId: 'event-1', resourceType: 'STUDENT', actorUserId: 'admin-1', correlationId: 'trace-1' });
  });
  it('does not create audit noise for migration snapshots', () => {
    expect(auditFromEvent({ source: 'content', event: { id: 'event-1', eventType: 'content.post-snapshot.v1', aggregateId: 'post-1', occurredAt: '2026-10-06T00:00:00Z', payload: { schoolId: 'school-1' } } })).toBeNull();
  });
});
