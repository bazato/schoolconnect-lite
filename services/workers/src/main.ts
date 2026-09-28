import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import { randomUUID } from 'node:crypto';

type OutboxEvent = { id: string; eventType: string; aggregateId: string; payload: Record<string, unknown>; occurredAt: string };
type Source = 'content' | 'attendance';
const urls = {
  content: process.env.CONTENT_SERVICE_URL ?? 'http://127.0.0.1:3103',
  attendance: process.env.ATTENDANCE_SERVICE_URL ?? 'http://127.0.0.1:3104',
  school: process.env.SCHOOL_SERVICE_URL ?? 'http://127.0.0.1:3102',
  notifications: process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:3106',
  audit: process.env.AUDIT_SERVICE_URL ?? 'http://127.0.0.1:3107',
};
const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
if (process.env.NODE_ENV === 'production' && (!internalToken || internalToken.length < 32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED');

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(internalToken ? { 'x-internal-service-token': internalToken } : {}), ...init?.headers }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`WORKER_DOWNSTREAM_${response.status}`);
  return response.json() as Promise<T>;
}

async function notify(event: OutboxEvent) {
  const payload = event.payload;
  const schoolId = String(payload.schoolId ?? '');
  if (!schoolId) return;
  if (['content.post-published.v1','content.post-updated.v1'].includes(event.eventType)) {
    const post = await request<{ title: string; body: string; postType: string }>(urls.content, `/internal/v1/posts/${event.aggregateId}?schoolId=${schoolId}`);
    const recipients = Array.isArray(payload.recipients) ? payload.recipients as Array<{ guardianUserId: string; studentId: string }> : [];
    await Promise.all(recipients.map((recipient) => request(urls.notifications, '/internal/v1/notifications', { method: 'POST', body: JSON.stringify({
      sourceEventId: event.id, schoolId, recipientUserId: recipient.guardianUserId, studentId: recipient.studentId,
      notificationType: event.eventType.includes('updated') ? 'POST_UPDATED' : 'POST_PUBLISHED', resourceType: 'POST', resourceId: event.aggregateId,
      title: post.title, body: post.body.slice(0, 500), deepLink: `schoolconnect://posts/${event.aggregateId}?studentId=${recipient.studentId}`,
    }) })));
  }
  if (event.eventType === 'attendance.student-absent.v1') {
    const studentId = String(payload.studentId);
    const guardians = await request<Array<{ guardianUserId: string }>>(urls.school, `/internal/v1/schools/${schoolId}/students/${studentId}/guardians`);
    await Promise.all(guardians.map((guardian) => request(urls.notifications, '/internal/v1/notifications', { method: 'POST', body: JSON.stringify({
      sourceEventId: event.id, schoolId, recipientUserId: guardian.guardianUserId, studentId, notificationType: 'ATTENDANCE_ABSENT',
      resourceType: 'ATTENDANCE_EVENT', resourceId: event.aggregateId, title: 'Student marked absent',
      body: `Attendance for ${String(payload.attendanceDate)}`, deepLink: `schoolconnect://attendance/${event.aggregateId}`,
    }) })));
  }
  if (event.eventType === 'attendance.leave-reviewed.v1' || event.eventType === 'attendance.corrected.v1') {
    const studentId = String(payload.studentId);
    const guardians = event.eventType === 'attendance.leave-reviewed.v1'
      ? [{ guardianUserId: String(payload.guardianUserId) }]
      : await request<Array<{ guardianUserId: string }>>(urls.school, `/internal/v1/schools/${schoolId}/students/${studentId}/guardians`);
    await Promise.all(guardians.map((guardian) => request(urls.notifications, '/internal/v1/notifications', { method: 'POST', body: JSON.stringify({
      sourceEventId: event.id, schoolId, recipientUserId: guardian.guardianUserId, studentId,
      notificationType: event.eventType === 'attendance.leave-reviewed.v1' ? 'LEAVE_REVIEWED' : 'ATTENDANCE_CORRECTED',
      resourceType: 'ATTENDANCE_EVENT', resourceId: String(payload.attendanceEventId ?? event.aggregateId),
      title: event.eventType === 'attendance.leave-reviewed.v1' ? `Leave request ${String(payload.status).toLowerCase()}` : 'Attendance corrected',
      body: event.eventType === 'attendance.leave-reviewed.v1' ? 'Your school reviewed the leave note.' : `Updated status: ${String(payload.status)}`,
      deepLink: `schoolconnect://attendance/${String(payload.attendanceEventId ?? event.aggregateId)}`,
    }) })));
  }
}

async function audit(event: OutboxEvent) {
  const schoolId = String(event.payload.schoolId ?? '');
  if (!schoolId) return;
  await request(urls.audit, '/internal/v1/audit-events', { method: 'POST', body: JSON.stringify({
    sourceEventId: event.id, schoolId, actorUserId: event.payload.actorUserId, actorMembershipId: event.payload.actorMembershipId,
    action: event.eventType, resourceType: event.eventType.startsWith('content.') ? 'POST' : 'ATTENDANCE_EVENT', resourceId: event.aggregateId,
    outcome: 'SUCCEEDED', correlationId: randomUUID(), metadata: event.payload, occurredAt: event.occurredAt,
  }) });
}

async function processSource(source: Source) {
  const events = await request<OutboxEvent[]>(urls[source], '/internal/v1/outbox?limit=25');
  for (const event of events) {
    let success = false;
    try { await notify(event); await audit(event); success = true; }
    catch (error) { console.error('outbox-event-failed', source, event.id, error instanceof Error ? error.message : error); }
    await request(urls[source], `/internal/v1/outbox/${event.id}/complete`, { method: 'POST', body: JSON.stringify({ success }) });
  }
}

async function tick() {
  await request(urls.content, '/internal/v1/scheduled/publish-due', { method: 'POST', body: JSON.stringify({ limit: 25 }) })
    .catch((error) => console.error('scheduled-publish-failed', error instanceof Error ? error.message : error));
  await Promise.all((['content', 'attendance'] as const).map((source) => processSource(source).catch((error) => console.error('outbox-source-failed', source, error instanceof Error ? error.message : error))));
}

const interval = Math.max(500, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2_000));
let running = false;
const run = async () => { if (running) return; running = true; try { await tick(); } finally { running = false; } };
void run();
setInterval(() => { void run(); }, interval);
