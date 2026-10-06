import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { Body, ConflictException, Controller, Get, Headers, Inject, Injectable, Module, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { startEventConsumer, startOutboxPublisher } from '@schoolconnect/eventing';
import { applyNotificationEvent } from './event-consumer';

@Injectable()
class NotificationRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.NOTIFICATION_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_notifications', max: Number(process.env.NOTIFICATIONS_DB_POOL_MAX ?? 8), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }
  async inbox(schoolId: string, recipientUserId: string, before?: string, limit = 50) {
    const result = await this.pool.query(
      `SELECT id, notification_type AS "notificationType", resource_type AS "resourceType", resource_id AS "resourceId", student_id AS "studentId", title, body, deep_link AS "deepLink", status, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE school_id=$1 AND recipient_user_id=$2 AND ($3::timestamptz IS NULL OR created_at<$3)
       ORDER BY created_at DESC,id DESC LIMIT $4`, [schoolId, recipientUserId, before ?? null, Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }
  async enqueue(input: { sourceEventId: string; schoolId: string; recipientUserId: string; studentId?: string; notificationType: string; resourceType: string; resourceId: string; title: string; body: string; deepLink: string }, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<{ id: string; status: string; createdAt: Date }>(
        `INSERT INTO notifications (source_event_id, school_id, recipient_user_id, student_id, notification_type, resource_type, resource_id, title, body, deep_link, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DELIVERED') ON CONFLICT DO NOTHING
         RETURNING id, status, created_at AS "createdAt"`,
        [input.sourceEventId, input.schoolId, input.recipientUserId, input.studentId ?? null, input.notificationType, input.resourceType, input.resourceId, input.title, input.body, input.deepLink]);
      const row = created.rows[0];
      if (row) {
        await client.query(`INSERT INTO delivery_attempts (notification_id,provider,status) VALUES ($1,'IN_APP','ACCEPTED')`, [row.id]);
        await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`, [domainEventTypes.notificationCreated, row.id,
          { schoolId: input.schoolId, notificationId: row.id, sourceEventId: input.sourceEventId, recipientUserId: input.recipientUserId, studentId: input.studentId, channel: 'IN_APP', correlationId }]);
      }
      const result = row ?? (await client.query<{ id: string; status: string; createdAt: Date }>(
        `SELECT id,status,created_at AS "createdAt" FROM notifications
         WHERE source_event_id=$1 AND recipient_user_id=$2 AND student_id IS NOT DISTINCT FROM $3::uuid AND school_id=$4`,
        [input.sourceEventId, input.recipientUserId, input.studentId ?? null, input.schoolId])).rows[0];
      if (!result) throw new ConflictException({ code: 'NOTIFICATION_EVENT_TENANT_CONFLICT' });
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async read(id: string, schoolId: string, recipientUserId: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const changed = await client.query<{ id: string; readAt: Date }>(
        `UPDATE notifications SET read_at=now() WHERE id=$1 AND school_id=$2 AND recipient_user_id=$3 AND read_at IS NULL
         RETURNING id,read_at AS "readAt"`, [id, schoolId, recipientUserId]);
      if (changed.rowCount) await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.notificationRead, id, { schoolId, notificationId: id, actorUserId: recipientUserId, recipientUserId, correlationId }]);
      const result = changed.rows[0] ?? (await client.query<{ id: string; readAt: Date }>(
        `SELECT id,read_at AS "readAt" FROM notifications WHERE id=$1 AND school_id=$2 AND recipient_user_id=$3`,
        [id, schoolId, recipientUserId])).rows[0] ?? null;
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async claimOutbox(limit: number) {
    const result = await this.pool.query(`UPDATE outbox_events SET attempt_count=attempt_count+1,available_at=now()+interval '30 seconds'
      WHERE id IN (SELECT id FROM outbox_events WHERE processed_at IS NULL AND available_at<=now() ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $1)
      RETURNING id,event_type AS "eventType",aggregate_id AS "aggregateId",payload,occurred_at AS "occurredAt"`, [Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }
  async completeOutbox(eventId: string, success: boolean) {
    await this.pool.query(success ? `UPDATE outbox_events SET processed_at=now() WHERE id=$1` : `UPDATE outbox_events SET available_at=now()+interval '1 minute' WHERE id=$1 AND processed_at IS NULL`, [eventId]);
    return { completed: success };
  }
  async resourceReport(schoolId: string, resourceType: string, resourceId: string) {
    const result = await this.pool.query(`SELECT COUNT(*)::int AS "inboxCount",COUNT(read_at)::int AS "readCount",
      COUNT(*) FILTER (WHERE status='DELIVERED')::int AS "deliveredCount",
      COUNT(*) FILTER (WHERE status='FAILED')::int AS "failedCount"
      FROM notifications WHERE school_id=$1 AND resource_type=$2 AND resource_id=$3`, [schoolId, resourceType, resourceId]);
    return result.rows[0];
  }
  async summary(schoolId: string, fromDate: string, toDate: string) {
    const result = await this.pool.query(`SELECT notification_type AS "notificationType",COUNT(*)::int AS count,COUNT(read_at)::int AS "readCount"
      FROM notifications WHERE school_id=$1 AND created_at::date BETWEEN $2 AND $3 GROUP BY notification_type ORDER BY notification_type`, [schoolId, fromDate, toDate]);
    return result.rows;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
@Controller('internal/v1')
class NotificationController {
  constructor(@Inject(NotificationRepository) private readonly repository: NotificationRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'notifications', database: await this.repository.health() }; }
  @Get('notifications') inbox(@Query('schoolId') schoolId: string, @Query('recipientUserId') recipientUserId: string, @Query('before') before?: string, @Query('limit') limit = '50') { return this.repository.inbox(schoolId, recipientUserId, before, Number(limit)); }
  @Post('notifications') enqueue(@Body() body: Parameters<NotificationRepository['enqueue']>[0], @Headers('x-correlation-id') correlationId?: string) { return this.repository.enqueue(body, correlationId); }
  @Post('notifications/:id/read') read(@Param('id') id: string, @Body() body: { schoolId: string; recipientUserId: string }, @Headers('x-correlation-id') correlationId?: string) { return this.repository.read(id, body.schoolId, body.recipientUserId, correlationId); }
  @Get('outbox') outbox(@Query('limit') limit = '25') { return this.repository.claimOutbox(Number(limit)); }
  @Post('outbox/:eventId/complete') completeOutbox(@Param('eventId') eventId: string, @Body() body: { success?: boolean }) { return this.repository.completeOutbox(eventId, body.success !== false); }
  @Get('resources/:resourceType/:resourceId/report') report(@Param('resourceType') resourceType: string, @Param('resourceId') resourceId: string, @Query('schoolId') schoolId: string) { return this.repository.resourceReport(schoolId, resourceType, resourceId); }
  @Get('notifications/summary') summary(@Query('schoolId') schoolId: string, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) { return this.repository.summary(schoolId, fromDate, toDate); }
}
@Module({ controllers: [NotificationController], providers: [NotificationRepository] }) class NotificationModule {}
async function bootstrap() { const app = await NestFactory.create(NotificationModule); const token=process.env.INTERNAL_SERVICE_TOKEN; if (process.env.NODE_ENV==='production' && (!token || token.length<32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED'); if(token) app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'})); await app.listen(Number(process.env.NOTIFICATION_PORT ?? 3106), process.env.SERVICE_BIND_HOST ?? '127.0.0.1'); const repository = app.get(NotificationRepository); await startOutboxPublisher('notifications', repository); await startEventConsumer('schoolconnect-notifications-v2', (event) => applyNotificationEvent(event, (input, correlationId) => repository.enqueue(input, correlationId))); }
void bootstrap();
