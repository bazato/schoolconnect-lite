import 'dotenv/config';
import 'reflect-metadata';
import { Body, Controller, Get, Inject, Injectable, Module, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

@Injectable()
class NotificationRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.NOTIFICATION_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_notifications' });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }
  async inbox(schoolId: string, recipientUserId: string) {
    const result = await this.pool.query(
      `SELECT id, notification_type AS "notificationType", resource_type AS "resourceType", resource_id AS "resourceId", student_id AS "studentId", title, body, deep_link AS "deepLink", status, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE school_id=$1 AND recipient_user_id=$2 ORDER BY created_at DESC LIMIT 100`, [schoolId, recipientUserId]);
    return result.rows;
  }
  async enqueue(input: { sourceEventId: string; schoolId: string; recipientUserId: string; studentId?: string; notificationType: string; resourceType: string; resourceId: string; title: string; body: string; deepLink: string }) {
    const result = await this.pool.query(
      `INSERT INTO notifications (source_event_id, school_id, recipient_user_id, student_id, notification_type, resource_type, resource_id, title, body, deep_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_event_id, recipient_user_id) DO UPDATE SET source_event_id=excluded.source_event_id
       RETURNING id, status, created_at AS "createdAt"`,
      [input.sourceEventId, input.schoolId, input.recipientUserId, input.studentId ?? null, input.notificationType, input.resourceType, input.resourceId, input.title, input.body, input.deepLink]);
    return result.rows[0];
  }
  async read(id: string, schoolId: string, recipientUserId: string) {
    const result = await this.pool.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND school_id=$2 AND recipient_user_id=$3 RETURNING id, read_at AS "readAt"`, [id, schoolId, recipientUserId]);
    return result.rows[0] ?? null;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
@Controller('internal/v1')
class NotificationController {
  constructor(@Inject(NotificationRepository) private readonly repository: NotificationRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'notifications', database: await this.repository.health() }; }
  @Get('notifications') inbox(@Query('schoolId') schoolId: string, @Query('recipientUserId') recipientUserId: string) { return this.repository.inbox(schoolId, recipientUserId); }
  @Post('notifications') enqueue(@Body() body: Parameters<NotificationRepository['enqueue']>[0]) { return this.repository.enqueue(body); }
  @Post('notifications/:id/read') read(@Param('id') id: string, @Body() body: { schoolId: string; recipientUserId: string }) { return this.repository.read(id, body.schoolId, body.recipientUserId); }
}
@Module({ controllers: [NotificationController], providers: [NotificationRepository] }) class NotificationModule {}
async function bootstrap() { const app = await NestFactory.create(NotificationModule); await app.listen(Number(process.env.NOTIFICATION_PORT ?? 3106), '127.0.0.1'); }
void bootstrap();
