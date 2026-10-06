import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { startOutboxPublisher } from '@schoolconnect/eventing';
import { validateAttendanceSubmission, type AttendanceStatus } from './validation';

type AttendanceBatchRequest = {
  schoolId: string; classId: string; attendanceDate: string; actorUserId: string; actorMembershipId: string;
  expectedVersion: number; idempotencyKey: string; correctionReason?: string; rows: Array<{ studentId: string; status: AttendanceStatus }>;
  correlationId?: string; notificationRecipients?: Array<{ studentId: string; guardianUserId: string }>;
};
const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
class AttendanceRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.ATTENDANCE_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_attendance', max: Number(process.env.ATTENDANCE_DB_POOL_MAX ?? 10), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  async submit(input: AttendanceBatchRequest) {
    validateAttendanceSubmission(input);
    const studentIds = new Set(input.rows.map((row) => row.studentId));
    if (input.notificationRecipients && (!Array.isArray(input.notificationRecipients) ||
        input.notificationRecipients.some((recipient) => !studentIds.has(recipient.studentId) || !recipient.guardianUserId))) {
      throw new BadRequestException({ code: 'ATTENDANCE_RECIPIENT_SNAPSHOT_INVALID' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${input.schoolId}:${input.classId}:${input.attendanceDate}`]);
      const hash = requestHash({ ...input, correlationId: undefined, notificationRecipients: undefined });
      const existing = await client.query<{ request_hash: string; response_body: unknown }>(
        `SELECT request_hash, response_body FROM idempotency_keys WHERE actor_id=$1 AND operation='SUBMIT_ATTENDANCE' AND idempotency_key=$2 AND expires_at>now() FOR UPDATE`,
        [input.actorUserId, input.idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0]!.request_hash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
        await client.query('COMMIT');
        return existing.rows[0]!.response_body;
      }
      const currentVersionResult = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(committed_version),0)::int AS version FROM attendance_batches WHERE school_id=$1 AND class_id=$2 AND attendance_date=$3`,
        [input.schoolId, input.classId, input.attendanceDate]);
      const currentVersion = currentVersionResult.rows[0]!.version;
      if (currentVersion !== input.expectedVersion) throw new ConflictException({ code: 'ATTENDANCE_VERSION_CONFLICT', expected: input.expectedVersion, actual: currentVersion });
      const committedVersion = currentVersion + 1;
      const batchId = randomUUID();
      await client.query(
        `INSERT INTO attendance_batches (id, school_id, class_id, attendance_date, submitted_by_membership_id, expected_version, committed_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [batchId, input.schoolId, input.classId, input.attendanceDate, input.actorMembershipId, input.expectedVersion, committedVersion]);
      let absenceNotificationsQueued = 0;
      for (const row of input.rows) {
        const guardians = input.notificationRecipients?.filter((recipient) => recipient.studentId === row.studentId)
          .map((recipient) => ({ guardianUserId: recipient.guardianUserId }));
        const current = await client.query<{ current_event_id: string; version: number }>(
          `SELECT current_event_id, version FROM attendance_current WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3 FOR UPDATE`,
          [input.schoolId, row.studentId, input.attendanceDate]);
        const previous = current.rows[0];
        const eventId = randomUUID();
        const revision = (previous?.version ?? 0) + 1;
        await client.query(
          `INSERT INTO attendance_events (id, batch_id, school_id, class_id, student_id, attendance_date, attendance_status, revision_number, recorded_by_membership_id, supersedes_event_id,correction_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [eventId, batchId, input.schoolId, input.classId, row.studentId, input.attendanceDate, row.status, revision, input.actorMembershipId, previous?.current_event_id ?? null, previous ? input.correctionReason?.trim() : null]);
        await client.query(
          `INSERT INTO attendance_current (school_id, student_id, attendance_date, current_event_id, version)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (school_id, student_id, attendance_date) DO UPDATE SET current_event_id=excluded.current_event_id, version=excluded.version, updated_at=now()`,
          [input.schoolId, row.studentId, input.attendanceDate, eventId, revision]);
        await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
          [domainEventTypes.attendanceRecorded, eventId, { schoolId: input.schoolId, classId: input.classId, studentId: row.studentId,
            attendanceDate: input.attendanceDate, status: row.status, revisionNumber: revision, attendanceEventId: eventId,
            actorUserId: input.actorUserId, actorMembershipId: input.actorMembershipId, correlationId: input.correlationId }]);
        if (row.status === 'ABSENT') {
          absenceNotificationsQueued += 1;
          await client.query(
            `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ($1,$2,$3)`,
            [domainEventTypes.studentAbsent, eventId, { schoolId: input.schoolId, attendanceEventId: eventId, studentId: row.studentId, attendanceDate: input.attendanceDate, correlationId: input.correlationId, guardians }]);
        } else if (previous) {
          await client.query(
            `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ($1,$2,$3)`,
            [domainEventTypes.attendanceCorrected, eventId, { schoolId: input.schoolId, attendanceEventId: eventId, studentId: row.studentId, status: row.status, supersedesEventId: previous.current_event_id, correlationId: input.correlationId, guardians }]);
        }
      }
      const response = { batchId, committed: true, version: committedVersion, rowCount: input.rows.length, absenceNotificationsQueued };
      await client.query(
        `INSERT INTO idempotency_keys (actor_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at)
         VALUES ($1,'SUBMIT_ATTENDANCE',$2,$3,201,$4,now()+interval '7 days')`,
        [input.actorUserId, input.idempotencyKey, hash, response]);
      await client.query('COMMIT');
      return response;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async event(schoolId: string, eventId: string) {
    const result = await this.pool.query(
      `SELECT e.id, e.school_id AS "schoolId", e.class_id AS "classId", e.student_id AS "studentId",
              e.attendance_date AS "attendanceDate", e.attendance_status AS "attendanceStatus", e.revision_number AS "revisionNumber",
              e.created_at AS "createdAt", e.supersedes_event_id AS "supersedesEventId"
       FROM attendance_events e WHERE e.school_id=$1 AND e.id=$2`, [schoolId, eventId]);
    if (!result.rowCount) throw new NotFoundException({ code: 'ATTENDANCE_EVENT_NOT_FOUND' });
    return result.rows[0];
  }

  async history(schoolId: string, studentId: string, guardianUserId?: string) {
    const result = await this.pool.query(
      `SELECT e.id, e.attendance_date AS "attendanceDate", e.attendance_status AS "attendanceStatus", e.revision_number AS "revisionNumber", e.created_at AS "createdAt",
       e.correction_reason AS "correctionReason",r.response_type AS "responseType",r.reason AS "responseReason",l.status AS "leaveStatus"
       FROM attendance_current c JOIN attendance_events e ON e.id=c.current_event_id
       LEFT JOIN absence_responses r ON r.attendance_event_id=e.id AND r.guardian_user_id=$3
       LEFT JOIN leave_requests l ON l.attendance_event_id=e.id AND l.guardian_user_id=$3
       WHERE c.school_id=$1 AND c.student_id=$2 ORDER BY c.attendance_date DESC LIMIT 180`, [schoolId, studentId, guardianUserId ?? null]);
    return result.rows;
  }

  async version(schoolId: string, classId: string, attendanceDate: string) {
    const result = await this.pool.query<{ version: number }>(
      `SELECT COALESCE(MAX(committed_version),0)::int AS version FROM attendance_batches WHERE school_id=$1 AND class_id=$2 AND attendance_date=$3`,
      [schoolId, classId, attendanceDate]);
    return result.rows[0]!;
  }

  async currentClass(schoolId: string, classId: string, attendanceDate: string) {
    const result = await this.pool.query(`SELECT e.id,e.student_id AS "studentId",e.attendance_status AS status,e.revision_number AS "revisionNumber",e.correction_reason AS "correctionReason"
      FROM attendance_current c JOIN attendance_events e ON e.id=c.current_event_id
      WHERE c.school_id=$1 AND e.class_id=$2 AND c.attendance_date=$3 ORDER BY e.student_id`, [schoolId, classId, attendanceDate]);
    return result.rows;
  }

  async projectionConsistency(schoolId: string) {
    const result = await this.pool.query(`WITH latest AS (
      SELECT DISTINCT ON (student_id,attendance_date) id,student_id,attendance_date,revision_number
      FROM attendance_events WHERE school_id=$1
      ORDER BY student_id,attendance_date,revision_number DESC
    ), current_projection AS (
      SELECT student_id,attendance_date,current_event_id,version FROM attendance_current WHERE school_id=$1
    )
    SELECT COALESCE(l.student_id,c.student_id) AS "studentId",
      COALESCE(l.attendance_date,c.attendance_date) AS "attendanceDate",
      l.id AS "latestEventId",c.current_event_id AS "projectedEventId",
      l.revision_number AS "latestRevision",c.version AS "projectedRevision"
    FROM latest l FULL OUTER JOIN current_projection c
      ON c.student_id=l.student_id AND c.attendance_date=l.attendance_date
    WHERE l.id IS DISTINCT FROM c.current_event_id OR l.revision_number IS DISTINCT FROM c.version
    ORDER BY "attendanceDate" DESC LIMIT 100`, [schoolId]);
    return { consistent: result.rows.length === 0, mismatches: result.rows };
  }

  async rebuildProjection(schoolId: string, actorMembershipId: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // This maintenance operation blocks concurrent attendance submissions for
      // the duration of the rebuild, so it cannot race an event/current write.
      await client.query(`SET LOCAL lock_timeout = '3000ms'`);
      await client.query('LOCK TABLE attendance_events, attendance_current IN SHARE ROW EXCLUSIVE MODE');
      const removed = await client.query<{ student_id: string }>(`WITH latest AS (
        SELECT DISTINCT ON (student_id,attendance_date) id,student_id,attendance_date,revision_number
        FROM attendance_events WHERE school_id=$1
        ORDER BY student_id,attendance_date,revision_number DESC,created_at DESC,id DESC
      )
      DELETE FROM attendance_current c WHERE c.school_id=$1 AND NOT EXISTS (
        SELECT 1 FROM latest l WHERE l.student_id=c.student_id AND l.attendance_date=c.attendance_date
          AND l.id=c.current_event_id AND l.revision_number=c.version
      ) RETURNING c.student_id`, [schoolId]);
      const restored = await client.query<{ student_id: string }>(`WITH latest AS (
        SELECT DISTINCT ON (student_id,attendance_date) id,student_id,attendance_date,revision_number
        FROM attendance_events WHERE school_id=$1
        ORDER BY student_id,attendance_date,revision_number DESC,created_at DESC,id DESC
      )
      INSERT INTO attendance_current (school_id,student_id,attendance_date,current_event_id,version)
      SELECT $1,l.student_id,l.attendance_date,l.id,l.revision_number FROM latest l
      WHERE NOT EXISTS (SELECT 1 FROM attendance_current c
        WHERE c.school_id=$1 AND c.student_id=l.student_id AND c.attendance_date=l.attendance_date)
      RETURNING student_id`, [schoolId]);
      const result = { removedRows: removed.rowCount ?? 0, restoredRows: restored.rowCount ?? 0 };
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.attendanceProjectionRebuilt, schoolId, { schoolId, actorMembershipId, correlationId, ...result }]);
      await client.query('COMMIT');
      return { ...result, consistent: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async acknowledge(input: { schoolId: string; eventId: string; guardianUserId: string; actorUserId: string; idempotencyKey: string; reason?: string; leaveNote: boolean; correlationId?: string }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const currentEvent = await client.query<{ student_id: string; attendance_status: string }>(
        `SELECT e.student_id,e.attendance_status FROM attendance_events e
         JOIN attendance_current c ON c.school_id=e.school_id AND c.student_id=e.student_id AND c.attendance_date=e.attendance_date AND c.current_event_id=e.id
         WHERE e.school_id=$1 AND e.id=$2 FOR UPDATE OF c,e`, [input.schoolId, input.eventId]);
      const event = currentEvent.rows[0];
      if (!event || event.attendance_status !== 'ABSENT') throw new ConflictException({ code: 'ATTENDANCE_EVENT_SUPERSEDED' });
      const hash = requestHash({ ...input, correlationId: undefined });
      const existing = await client.query<{ request_hash: string; response_body: unknown }>(
        `SELECT request_hash, response_body FROM idempotency_keys WHERE actor_id=$1 AND operation='ACKNOWLEDGE_ABSENCE' AND idempotency_key=$2 AND expires_at>now() FOR UPDATE`,
        [input.actorUserId, input.idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0]!.request_hash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
        await client.query('COMMIT'); return existing.rows[0]!.response_body;
      }
      const previousResponse = await client.query<{ id: string; response_type: string; reason: string | null }>(
        `SELECT id,response_type,reason FROM absence_responses WHERE attendance_event_id=$1 AND guardian_user_id=$2 FOR UPDATE`,
        [input.eventId, input.guardianUserId]);
      const responseType = input.leaveNote ? 'LEAVE_SUBMITTED' : 'ACKNOWLEDGED';
      if (previousResponse.rowCount) {
        const previous = previousResponse.rows[0]!;
        if (previous.response_type !== responseType || (previous.reason ?? '') !== (input.reason?.trim() ?? '')) throw new ConflictException({ code: 'ABSENCE_RESPONSE_ALREADY_RECORDED' });
        await client.query('COMMIT');
        return { id: previous.id, attendanceEventId: input.eventId, responseType: previous.response_type, reason: previous.reason };
      }
      const responseId = randomUUID();
      await client.query(
        `INSERT INTO absence_responses (id, school_id, attendance_event_id, guardian_user_id, response_type, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
        [responseId, input.schoolId, input.eventId, input.guardianUserId, responseType, input.reason ?? null]);
      let leaveRequestId: string | undefined;
      if (input.leaveNote) {
        leaveRequestId = randomUUID();
        await client.query(
          `INSERT INTO leave_requests (id, school_id, attendance_event_id, student_id, guardian_user_id, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
          [leaveRequestId, input.schoolId, input.eventId, event.student_id, input.guardianUserId, input.reason?.trim() || null]);
      }
      const eventOutboxId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload) VALUES ($1,$2,$3,$4)`,
        [eventOutboxId, domainEventTypes.absenceAcknowledged, input.eventId, { schoolId: input.schoolId, attendanceEventId: input.eventId, responseId, guardianUserId: input.guardianUserId, responseType, leaveRequestId, correlationId: input.correlationId }]);
      const response = { id: responseId, attendanceEventId: input.eventId, responseType, reason: input.reason, leaveRequestId };
      await client.query(
        `INSERT INTO idempotency_keys (actor_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at)
         VALUES ($1,'ACKNOWLEDGE_ABSENCE',$2,$3,201,$4,now()+interval '7 days')`,
        [input.actorUserId, input.idempotencyKey, hash, response]);
      await client.query('COMMIT'); return response;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async followUps(schoolId: string, classId: string, attendanceDate: string) {
    const result = await this.pool.query(
      `SELECT e.id AS "attendanceEventId", e.student_id AS "studentId", e.attendance_status AS "attendanceStatus",
              CASE WHEN COUNT(r.id)>0 THEN 'ACKNOWLEDGED' ELSE 'PENDING' END AS "responseStatus", COUNT(r.id)::int AS "responseCount"
       FROM attendance_current c JOIN attendance_events e ON e.id=c.current_event_id
       LEFT JOIN absence_responses r ON r.attendance_event_id=e.id
       WHERE e.school_id=$1 AND e.class_id=$2 AND e.attendance_date=$3 AND e.attendance_status='ABSENT'
       GROUP BY e.id ORDER BY e.created_at`, [schoolId, classId, attendanceDate]);
    return result.rows;
  }

  async leaveRequests(schoolId: string, status?: string) {
    const result = await this.pool.query(`SELECT l.id,l.student_id AS "studentId",l.guardian_user_id AS "guardianUserId",l.attendance_event_id AS "attendanceEventId",
      e.class_id AS "classId",e.attendance_date AS "attendanceDate",l.reason,l.status,l.review_note AS "reviewNote",l.created_at AS "createdAt",l.reviewed_at AS "reviewedAt"
      FROM leave_requests l JOIN attendance_events e ON e.id=l.attendance_event_id
      WHERE l.school_id=$1 AND ($2::text IS NULL OR l.status=$2) ORDER BY l.created_at DESC LIMIT 200`, [schoolId, status ?? null]);
    return result.rows;
  }

  async reviewLeave(schoolId: string, leaveRequestId: string, actorMembershipId: string, decision: 'APPROVED' | 'REJECTED', reviewNote?: string, correlationId?: string) {
    if (!['APPROVED','REJECTED'].includes(decision)) throw new BadRequestException({ code: 'LEAVE_DECISION_INVALID' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: string; attendance_event_id: string; guardian_user_id: string; student_id: string }>(
        `SELECT status,attendance_event_id,guardian_user_id,student_id FROM leave_requests WHERE school_id=$1 AND id=$2 FOR UPDATE`, [schoolId, leaveRequestId]);
      if (!current.rowCount) throw new NotFoundException({ code: 'LEAVE_REQUEST_NOT_FOUND' });
      if (current.rows[0]!.status !== 'PENDING') throw new ConflictException({ code: 'LEAVE_ALREADY_REVIEWED' });
      const active = await client.query(`SELECT 1 FROM attendance_current WHERE current_event_id=$1`, [current.rows[0]!.attendance_event_id]);
      if (!active.rowCount) throw new ConflictException({ code: 'ATTENDANCE_EVENT_SUPERSEDED' });
      const result = await client.query(`UPDATE leave_requests SET status=$3,reviewed_by_membership_id=$4,reviewed_at=now(),review_note=$5
        WHERE school_id=$1 AND id=$2 RETURNING id,status,reviewed_at AS "reviewedAt",review_note AS "reviewNote"`,
        [schoolId, leaveRequestId, decision, actorMembershipId, reviewNote?.trim() ?? null]);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.leaveReviewed, leaveRequestId, { schoolId, leaveRequestId, studentId: current.rows[0]!.student_id, guardianUserId: current.rows[0]!.guardian_user_id, status: decision, actorMembershipId, correlationId }]);
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async summary(schoolId: string, fromDate: string, toDate: string) {
    const result = await this.pool.query(`SELECT e.class_id AS "classId",e.attendance_status AS status,COUNT(*)::int AS count
      FROM attendance_current c JOIN attendance_events e ON e.id=c.current_event_id
      WHERE c.school_id=$1 AND c.attendance_date BETWEEN $2 AND $3 GROUP BY e.class_id,e.attendance_status ORDER BY e.class_id,e.attendance_status`,
      [schoolId, fromDate, toDate]);
    return result.rows;
  }

  async claimOutbox(limit: number) {
    const result = await this.pool.query(
      `UPDATE outbox_events SET attempt_count=attempt_count+1,available_at=now()+interval '30 seconds'
       WHERE id IN (SELECT id FROM outbox_events WHERE processed_at IS NULL AND available_at<=now() ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $1)
       RETURNING id,event_type AS "eventType",aggregate_id AS "aggregateId",payload,occurred_at AS "occurredAt"`, [Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }
  async completeOutbox(eventId: string, success: boolean) {
    await this.pool.query(success ? `UPDATE outbox_events SET processed_at=now() WHERE id=$1` : `UPDATE outbox_events SET available_at=now()+interval '1 minute' WHERE id=$1 AND processed_at IS NULL`, [eventId]);
    return { completed: success };
  }

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class AttendanceController {
  constructor(@Inject(AttendanceRepository) private readonly repository: AttendanceRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'attendance', database: await this.repository.health() }; }
  @Post('attendance/batches') batch(@Body() body: AttendanceBatchRequest) { return this.repository.submit(body); }
  @Get('attendance/events/:eventId') event(@Param('eventId') eventId: string, @Query('schoolId') schoolId: string) { return this.repository.event(schoolId, eventId); }
  @Get('students/:studentId/attendance') history(@Param('studentId') studentId: string, @Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId?: string) { return this.repository.history(schoolId, studentId, guardianUserId); }
  @Get('attendance/version') version(@Query('schoolId') schoolId: string, @Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string) { return this.repository.version(schoolId, classId, attendanceDate); }
  @Get('attendance/current') current(@Query('schoolId') schoolId: string, @Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string) { return this.repository.currentClass(schoolId, classId, attendanceDate); }
  @Get('attendance/projection-consistency') projectionConsistency(@Query('schoolId') schoolId: string) { return this.repository.projectionConsistency(schoolId); }
  @Post('attendance/rebuild-projection') rebuildProjection(@Body() body: { schoolId: string; actorMembershipId: string; correlationId?: string }) { return this.repository.rebuildProjection(body.schoolId, body.actorMembershipId, body.correlationId); }
  @Post('attendance/events/:eventId/acknowledgements') acknowledge(@Param('eventId') eventId: string, @Body() body: Omit<Parameters<AttendanceRepository['acknowledge']>[0], 'eventId'>) { return this.repository.acknowledge({ ...body, eventId }); }
  @Get('attendance/follow-ups') followUps(@Query('schoolId') schoolId: string, @Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string) { return this.repository.followUps(schoolId, classId, attendanceDate); }
  @Get('leave-requests') leaveRequests(@Query('schoolId') schoolId: string, @Query('status') status?: string) { return this.repository.leaveRequests(schoolId, status); }
  @Post('leave-requests/:leaveRequestId/review') reviewLeave(@Param('leaveRequestId') leaveRequestId: string, @Body() body: { schoolId: string; actorMembershipId: string; decision: 'APPROVED' | 'REJECTED'; reviewNote?: string; correlationId?: string }) { return this.repository.reviewLeave(body.schoolId, leaveRequestId, body.actorMembershipId, body.decision, body.reviewNote, body.correlationId); }
  @Get('attendance/summary') summary(@Query('schoolId') schoolId: string, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) { return this.repository.summary(schoolId, fromDate, toDate); }
  @Get('outbox') outbox(@Query('limit') limit = '25') { return this.repository.claimOutbox(Number(limit)); }
  @Post('outbox/:eventId/complete') completeOutbox(@Param('eventId') eventId: string, @Body() body: { success?: boolean }) { return this.repository.completeOutbox(eventId, body.success !== false); }
}

@Module({ controllers: [AttendanceController], providers: [AttendanceRepository] })
class AttendanceModule {}
async function bootstrap() { const app = await NestFactory.create(AttendanceModule); const token=process.env.INTERNAL_SERVICE_TOKEN; if (process.env.NODE_ENV==='production' && (!token || token.length<32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED'); if(token) app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'})); await app.listen(Number(process.env.ATTENDANCE_PORT ?? 3104), process.env.SERVICE_BIND_HOST ?? '127.0.0.1'); await startOutboxPublisher('attendance', app.get(AttendanceRepository)); }
void bootstrap();
