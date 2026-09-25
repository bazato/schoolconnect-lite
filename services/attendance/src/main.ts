import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
type AttendanceBatchRequest = {
  schoolId: string; classId: string; attendanceDate: string; actorUserId: string; actorMembershipId: string;
  expectedVersion: number; idempotencyKey: string; rows: Array<{ studentId: string; status: AttendanceStatus }>;
};
const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
class AttendanceRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.ATTENDANCE_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_attendance' });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  async submit(input: AttendanceBatchRequest) {
    if (!input.rows?.length || new Set(input.rows.map((row) => row.studentId)).size !== input.rows.length) throw new BadRequestException({ code: 'INVALID_OR_DUPLICATE_ROWS' });
    const valid = new Set<AttendanceStatus>(['PRESENT', 'ABSENT', 'LATE', 'LEAVE']);
    if (input.rows.some((row) => !valid.has(row.status))) throw new BadRequestException({ code: 'INVALID_ATTENDANCE_STATUS' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${input.schoolId}:${input.classId}:${input.attendanceDate}`]);
      const hash = requestHash(input);
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
        const current = await client.query<{ current_event_id: string; version: number }>(
          `SELECT current_event_id, version FROM attendance_current WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3 FOR UPDATE`,
          [input.schoolId, row.studentId, input.attendanceDate]);
        const previous = current.rows[0];
        const eventId = randomUUID();
        const revision = (previous?.version ?? 0) + 1;
        await client.query(
          `INSERT INTO attendance_events (id, batch_id, school_id, class_id, student_id, attendance_date, attendance_status, revision_number, recorded_by_membership_id, supersedes_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [eventId, batchId, input.schoolId, input.classId, row.studentId, input.attendanceDate, row.status, revision, input.actorMembershipId, previous?.current_event_id ?? null]);
        await client.query(
          `INSERT INTO attendance_current (school_id, student_id, attendance_date, current_event_id, version)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (school_id, student_id, attendance_date) DO UPDATE SET current_event_id=excluded.current_event_id, version=excluded.version, updated_at=now()`,
          [input.schoolId, row.studentId, input.attendanceDate, eventId, revision]);
        if (row.status === 'ABSENT') {
          absenceNotificationsQueued += 1;
          await client.query(
            `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('attendance.student-absent.v1',$1,$2)`,
            [eventId, { schoolId: input.schoolId, attendanceEventId: eventId, studentId: row.studentId, attendanceDate: input.attendanceDate }]);
        } else if (previous) {
          await client.query(
            `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('attendance.corrected.v1',$1,$2)`,
            [eventId, { schoolId: input.schoolId, attendanceEventId: eventId, studentId: row.studentId, status: row.status, supersedesEventId: previous.current_event_id }]);
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

  async history(schoolId: string, studentId: string) {
    const result = await this.pool.query(
      `SELECT e.id, e.attendance_date AS "attendanceDate", e.attendance_status AS "attendanceStatus", e.revision_number AS "revisionNumber", e.created_at AS "createdAt"
       FROM attendance_current c JOIN attendance_events e ON e.id=c.current_event_id
       WHERE c.school_id=$1 AND c.student_id=$2 ORDER BY c.attendance_date DESC LIMIT 180`, [schoolId, studentId]);
    return result.rows;
  }

  async acknowledge(input: { schoolId: string; eventId: string; guardianUserId: string; actorUserId: string; idempotencyKey: string; reason?: string; leaveNote: boolean }) {
    const event = await this.event(input.schoolId, input.eventId) as { attendanceStatus: string; studentId: string };
    if (event.attendanceStatus !== 'ABSENT') throw new ConflictException({ code: 'ATTENDANCE_EVENT_SUPERSEDED' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const hash = requestHash(input);
      const existing = await client.query<{ request_hash: string; response_body: unknown }>(
        `SELECT request_hash, response_body FROM idempotency_keys WHERE actor_id=$1 AND operation='ACKNOWLEDGE_ABSENCE' AND idempotency_key=$2 AND expires_at>now() FOR UPDATE`,
        [input.actorUserId, input.idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0]!.request_hash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
        await client.query('COMMIT'); return existing.rows[0]!.response_body;
      }
      const responseId = randomUUID();
      const responseType = input.leaveNote ? 'LEAVE_SUBMITTED' : 'ACKNOWLEDGED';
      await client.query(
        `INSERT INTO absence_responses (id, school_id, attendance_event_id, guardian_user_id, response_type, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
        [responseId, input.schoolId, input.eventId, input.guardianUserId, responseType, input.reason ?? null]);
      let leaveRequestId: string | undefined;
      if (input.leaveNote) {
        leaveRequestId = randomUUID();
        await client.query(
          `INSERT INTO leave_requests (id, school_id, attendance_event_id, student_id, guardian_user_id, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
          [leaveRequestId, input.schoolId, input.eventId, event.studentId, input.guardianUserId, input.reason ?? null]);
      }
      const eventOutboxId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload) VALUES ($1,'attendance.absence-acknowledged.v1',$2,$3)`,
        [eventOutboxId, input.eventId, { schoolId: input.schoolId, attendanceEventId: input.eventId, responseId, guardianUserId: input.guardianUserId, responseType, leaveRequestId }]);
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

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class AttendanceController {
  constructor(@Inject(AttendanceRepository) private readonly repository: AttendanceRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'attendance', database: await this.repository.health() }; }
  @Post('attendance/batches') batch(@Body() body: AttendanceBatchRequest) { return this.repository.submit(body); }
  @Get('attendance/events/:eventId') event(@Param('eventId') eventId: string, @Query('schoolId') schoolId: string) { return this.repository.event(schoolId, eventId); }
  @Get('students/:studentId/attendance') history(@Param('studentId') studentId: string, @Query('schoolId') schoolId: string) { return this.repository.history(schoolId, studentId); }
  @Post('attendance/events/:eventId/acknowledgements') acknowledge(@Param('eventId') eventId: string, @Body() body: Omit<Parameters<AttendanceRepository['acknowledge']>[0], 'eventId'>) { return this.repository.acknowledge({ ...body, eventId }); }
  @Get('attendance/follow-ups') followUps(@Query('schoolId') schoolId: string, @Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string) { return this.repository.followUps(schoolId, classId, attendanceDate); }
}

@Module({ controllers: [AttendanceController], providers: [AttendanceRepository] })
class AttendanceModule {}
async function bootstrap() { const app = await NestFactory.create(AttendanceModule); await app.listen(Number(process.env.ATTENDANCE_PORT ?? 3104), '127.0.0.1'); }
void bootstrap();
