import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { Body, Controller, Get, Inject, Injectable, Module, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

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
  async enqueue(input: { sourceEventId: string; schoolId: string; recipientUserId: string; studentId?: string; notificationType: string; resourceType: string; resourceId: string; title: string; body: string; deepLink: string }) {
    const result = await this.pool.query(
      `INSERT INTO notifications (source_event_id, school_id, recipient_user_id, student_id, notification_type, resource_type, resource_id, title, body, deep_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_event_id, recipient_user_id, student_id) DO UPDATE SET source_event_id=excluded.source_event_id
       RETURNING id, status, created_at AS "createdAt"`,
      [input.sourceEventId, input.schoolId, input.recipientUserId, input.studentId ?? null, input.notificationType, input.resourceType, input.resourceId, input.title, input.body, input.deepLink]);
    return result.rows[0];
  }
  async read(id: string, schoolId: string, recipientUserId: string) {
    const result = await this.pool.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND school_id=$2 AND recipient_user_id=$3 RETURNING id, read_at AS "readAt"`, [id, schoolId, recipientUserId]);
    return result.rows[0] ?? null;
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
  @Post('notifications') enqueue(@Body() body: Parameters<NotificationRepository['enqueue']>[0]) { return this.repository.enqueue(body); }
  @Post('notifications/:id/read') read(@Param('id') id: string, @Body() body: { schoolId: string; recipientUserId: string }) { return this.repository.read(id, body.schoolId, body.recipientUserId); }
  @Get('resources/:resourceType/:resourceId/report') report(@Param('resourceType') resourceType: string, @Param('resourceId') resourceId: string, @Query('schoolId') schoolId: string) { return this.repository.resourceReport(schoolId, resourceType, resourceId); }
  @Get('notifications/summary') summary(@Query('schoolId') schoolId: string, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) { return this.repository.summary(schoolId, fromDate, toDate); }
}
@Module({ controllers: [NotificationController], providers: [NotificationRepository] }) class NotificationModule {}
async function bootstrap() { const app = await NestFactory.create(NotificationModule); const token=process.env.INTERNAL_SERVICE_TOKEN; if (process.env.NODE_ENV==='production' && (!token || token.length<32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED'); if(token) app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'})); await app.listen(Number(process.env.NOTIFICATION_PORT ?? 3106), process.env.SERVICE_BIND_HOST ?? '127.0.0.1'); }
void bootstrap();
