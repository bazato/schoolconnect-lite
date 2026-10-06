import { describe, expect, it, vi } from 'vitest';
import { applyNotificationEvent } from './event-consumer';

describe('notification event consumer', () => {
  it('uses event snapshots without reading other services', async () => {
    const enqueue = vi.fn().mockResolvedValue({ id: 'n1' });
    await applyNotificationEvent({ source: 'content', event: { id: 'e1', eventType: 'content.post-published.v1', aggregateId: 'p1', occurredAt: '2026-10-06T00:00:00Z',
      payload: { schoolId: 's1', correlationId: 'trace-1', notification: { title: 'Notice', body: 'Details' }, recipients: [{ guardianUserId: 'g1', studentId: 'st1' }] } } }, enqueue);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'e1', recipientUserId: 'g1', studentId: 'st1', title: 'Notice' }), 'trace-1');
  });
  it('does not notify for a scheduled draft or a replay snapshot', async () => {
    const enqueue = vi.fn();
    for (const eventType of ['content.post-scheduled.v1','content.post-snapshot.v1']) {
      await applyNotificationEvent({ source: 'content', event: { id: 'e1', eventType, aggregateId: 'p1', occurredAt: '2026-10-06T00:00:00Z', payload: { schoolId: 's1' } } }, enqueue);
    }
    expect(enqueue).not.toHaveBeenCalled();
  });
});
