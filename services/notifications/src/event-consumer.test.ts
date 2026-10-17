import { describe, expect, it, vi } from 'vitest';
import { applyNotificationEvent } from './event-consumer';

describe('notification event consumer', () => {
  it('deduplicates class teachers and never includes leave reasons in notices',async()=>{
    const enqueue=vi.fn().mockResolvedValue({});
    await applyNotificationEvent({source:'attendance',event:{id:'event',eventType:'attendance.leave-application-submitted.v1',aggregateId:'leave',occurredAt:'2026-10-17',payload:{schoolId:'school',classId:'class',teacherUserIds:['teacher','teacher'],reason:'PRIVATE'}}},enqueue);
    expect(enqueue).toHaveBeenCalledOnce();expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({recipientUserId:'teacher',deepLink:'schoolconnect://leave-applications/class'}),'event');expect(JSON.stringify(enqueue.mock.calls)).not.toContain('PRIVATE');
  });
  it('returns a teacher acknowledgement to the applying parent',async()=>{
    const enqueue=vi.fn().mockResolvedValue({});
    await applyNotificationEvent({source:'attendance',event:{id:'event',eventType:'attendance.leave-application-acknowledged.v1',aggregateId:'leave',occurredAt:'2026-10-17',payload:{schoolId:'school',studentId:'child',guardianUserId:'parent'}}},enqueue);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({recipientUserId:'parent',studentId:'child',notificationType:'LEAVE_ACKNOWLEDGED',deepLink:'schoolconnect://leave-applications/child'}),'event');
  });
  it('sends one timetable notice per guardian when siblings share a class',async()=>{
    const enqueue=vi.fn().mockResolvedValue({});
    await applyNotificationEvent({source:'content',event:{id:'event',eventType:'content.timetable-published.v1',aggregateId:'schedule',occurredAt:'2026-10-17',payload:{schoolId:'school',recipients:[{guardianUserId:'parent',studentId:'one'},{guardianUserId:'parent',studentId:'two'}]}}},enqueue);
    expect(enqueue).toHaveBeenCalledOnce();expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({notificationType:'TIMETABLE_PUBLISHED',resourceType:'TIMETABLE'}),'event');
  });
  it('notifies teachers once per event without a student ID and keeps parent-child deliveries',async()=>{
    const enqueue=vi.fn().mockResolvedValue({id:'n'});
    await applyNotificationEvent({source:'content',event:{id:'e',eventType:'content.post-published.v1',aggregateId:'holiday',occurredAt:new Date().toISOString(),payload:{schoolId:'s1',notification:{title:'Holiday',body:'School is closed'},recipients:[{guardianUserId:'parent',studentId:'kid'}],staffRecipients:['teacher','teacher']}}},enqueue);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({recipientUserId:'parent',studentId:'kid',deepLink:'schoolconnect://posts/holiday?studentId=kid'}),'e');
    const staff=enqueue.mock.calls.find(([input])=>input.recipientUserId==='teacher')![0];expect(staff.notificationType).toBe('SCHOOL_ANNOUNCEMENT');expect(staff).not.toHaveProperty('studentId');expect(staff.deepLink).toBe('schoolconnect://posts/holiday');
  });
  it('waits for all recipient writes before propagating a partial fanout failure',async () => {
    let finish!: () => void;let completed=false;
    const enqueue=vi.fn().mockRejectedValueOnce(new Error('write failed')).mockImplementationOnce(() => new Promise<void>((resolve) => {finish=() => {completed=true;resolve();};}));
    let settled=false;
    const result=applyNotificationEvent({source:'content',event:{id:'e1',eventType:'content.post-published.v1',aggregateId:'p1',occurredAt:'2026-10-14T00:00:00Z',payload:{schoolId:'s1',notification:{title:'Notice',body:'Details'},recipients:[{guardianUserId:'g1',studentId:'st1'},{guardianUserId:'g2',studentId:'st2'}]}}},enqueue)
      .then(() => {settled=true;},(error) => {settled=true;return error;});
    await Promise.resolve();expect(settled).toBe(false);finish();expect(await result).toBeInstanceOf(Error);expect(completed).toBe(true);
  });
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
