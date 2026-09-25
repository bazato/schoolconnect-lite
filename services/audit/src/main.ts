import 'dotenv/config';
import 'reflect-metadata';
import { Body, Controller, Get, Inject, Injectable, Module, OnModuleDestroy, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

@Injectable()
class AuditRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.AUDIT_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_audit' });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }
  async append(input: { sourceEventId?: string; schoolId: string; actorUserId?: string; actorMembershipId?: string; action: string; resourceType: string; resourceId: string; outcome: 'SUCCEEDED' | 'DENIED' | 'FAILED'; correlationId: string; metadata?: Record<string, unknown>; occurredAt: string }) {
    const result = await this.pool.query(
      `INSERT INTO audit_events (source_event_id, school_id, actor_user_id, actor_membership_id, action, resource_type, resource_id, outcome, correlation_id, metadata, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (source_event_id, action) DO UPDATE SET source_event_id=excluded.source_event_id
       RETURNING id, recorded_at AS "recordedAt"`,
      [input.sourceEventId ?? null, input.schoolId, input.actorUserId ?? null, input.actorMembershipId ?? null, input.action, input.resourceType, input.resourceId, input.outcome, input.correlationId, input.metadata ?? {}, input.occurredAt]);
    return result.rows[0];
  }
  async list(schoolId: string, resourceType?: string, resourceId?: string) {
    const result = await this.pool.query(
      `SELECT id, action, resource_type AS "resourceType", resource_id AS "resourceId", outcome, correlation_id AS "correlationId", metadata, occurred_at AS "occurredAt"
       FROM audit_events WHERE school_id=$1 AND ($2::text IS NULL OR resource_type=$2) AND ($3::uuid IS NULL OR resource_id=$3)
       ORDER BY occurred_at DESC LIMIT 200`, [schoolId, resourceType ?? null, resourceId ?? null]);
    return result.rows;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
@Controller('internal/v1')
class AuditController {
  constructor(@Inject(AuditRepository) private readonly repository: AuditRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'audit', database: await this.repository.health() }; }
  @Post('audit-events') append(@Body() body: Parameters<AuditRepository['append']>[0]) { return this.repository.append(body); }
  @Get('audit-events') list(@Query('schoolId') schoolId: string, @Query('resourceType') resourceType?: string, @Query('resourceId') resourceId?: string) { return this.repository.list(schoolId, resourceType, resourceId); }
}
@Module({ controllers: [AuditController], providers: [AuditRepository] }) class AuditModule {}
async function bootstrap() { const app = await NestFactory.create(AuditModule); await app.listen(Number(process.env.AUDIT_PORT ?? 3107), '127.0.0.1'); }
void bootstrap();
