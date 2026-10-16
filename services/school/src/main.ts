import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Patch, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool, type PoolClient } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { generatedCode, subjectCodeFor } from './codes';
import { PgOutbox, PgConsumerFailures, EventReplayError, parseEventEnvelope, type EventEnvelope, eventingStatus, eventingHealth, bindEventingShutdown, registerApplicationShutdown, startOutboxPublisher, startEventConsumer } from '@schoolconnect/eventing';
import { applyIdentityEvent, type MembershipState } from './identity-events';

@Injectable()
export class SchoolRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.SCHOOL_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_school', max: Number(process.env.SCHOOL_DB_POOL_MAX ?? 10), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  readonly failures=new PgConsumerFailures(this.pool,'schoolconnect-school-identity-v1');
  async consumeIdentity(envelope:EventEnvelope) {
    return applyIdentityEvent(envelope,async(id)=>{
      const response=await fetch(`${process.env.IDENTITY_SERVICE_URL ?? 'http://127.0.0.1:3101'}/internal/v1/members/${encodeURIComponent(id)}`,{headers:process.env.INTERNAL_SERVICE_TOKEN ? {'x-internal-service-token':process.env.INTERNAL_SERVICE_TOKEN} : {},signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error('IDENTITY_MEMBERSHIP_LOOKUP_FAILED');
      return response.json() as Promise<MembershipState>;
    },(event,current)=>this.applyMembershipState(event,current));
  }
  async replayFailure(id:string,actor:string) { return this.failures.replay(id,actor,(raw)=>this.consumeIdentity(parseEventEnvelope(raw))); }
  async applyMembershipState(envelope:EventEnvelope,current:MembershipState) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[current.membershipId]);
      const inserted=await client.query(`INSERT INTO identity_membership_events(event_id,membership_id,occurred_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id`,[envelope.event.id,current.membershipId,envelope.event.occurredAt]);
      if(!inserted.rowCount) { await client.query('COMMIT'); return; }
      const previous=envelope.event.payload.previousUserId;
      if(current.role==='PARENT' && typeof previous==='string' && previous!==current.userId) {
        const students=envelope.event.payload.guardianStudentIds;
        if(!Array.isArray(students) || students.some((id)=>typeof id!=='string' || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('GUARDIAN_TRANSFER_CONTEXT_REQUIRED');
        await client.query(`INSERT INTO guardian_identity_aliases(school_id,student_id,current_user_id,previous_user_id)
          SELECT school_id,student_id,$3::uuid,guardian_user_id FROM guardian_links WHERE school_id=$1 AND guardian_user_id=$2 AND student_id=ANY($4::uuid[])
          UNION SELECT school_id,student_id,$3::uuid,previous_user_id FROM guardian_identity_aliases WHERE school_id=$1 AND current_user_id=$2 AND student_id=ANY($4::uuid[])
          ON CONFLICT DO NOTHING`,[current.schoolId,previous,current.userId,students]);
        await client.query(`INSERT INTO guardian_links(school_id,guardian_user_id,student_id,relationship,status,valid_until)
          SELECT school_id,$3,student_id,relationship,CASE WHEN $4='ACTIVE' THEN 'ACTIVE' ELSE 'REVOKED' END,CASE WHEN $4='ACTIVE' THEN NULL ELSE now() END
          FROM guardian_links WHERE school_id=$1 AND guardian_user_id=$2 AND student_id=ANY($5::uuid[])
          ON CONFLICT(school_id,guardian_user_id,student_id) DO UPDATE SET status=excluded.status,valid_until=excluded.valid_until`,[current.schoolId,previous,current.userId,current.status,students]);
        await client.query(`UPDATE guardian_links SET status='REVOKED',valid_until=now() WHERE school_id=$1 AND guardian_user_id=$2 AND student_id=ANY($3::uuid[]) AND status='ACTIVE'`,[current.schoolId,previous,students]);
      }
      if(current.status!=='ACTIVE') {
        if(current.role==='PARENT') await client.query(`UPDATE guardian_links SET status='REVOKED',valid_until=now() WHERE school_id=$1 AND guardian_user_id=$2 AND status='ACTIVE'`,[current.schoolId,current.userId]);
        if(current.role==='TEACHER') await client.query(`UPDATE teacher_assignments SET status='REVOKED' WHERE school_id=$1 AND teacher_membership_id=$2`,[current.schoolId,current.membershipId]);
      }
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
  }
  private async mutateWithEvent<T>(eventType: string, aggregateId: string, payload: Record<string, unknown>, mutate: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await mutate(client);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`, [eventType,aggregateId,payload]);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  async school(schoolId: string) {
    const result = await this.pool.query(
      `SELECT s.id, s.school_code AS "schoolCode", s.display_name AS "displayName", s.timezone,true AS active,
              c.attendance_edit_window_hours AS "attendanceEditWindowHours", c.guardian_ack_policy AS "guardianAckPolicy",
              c.result_release_policy AS "resultReleasePolicy", c.allowed_file_types AS "allowedFileTypes",
              c.max_file_bytes AS "maxFileBytes", c.max_files_per_post AS "maxFilesPerPost",
              c.scheduled_announcements_enabled AS "scheduledAnnouncementsEnabled",
              c.school_wide_announcements_enabled AS "schoolWideAnnouncementsEnabled",
              c.grade_wide_announcements_enabled AS "gradeWideAnnouncementsEnabled",
              c.urgent_announcements_enabled AS "urgentAnnouncementsEnabled"
       FROM schools s JOIN school_configurations c ON c.school_id = s.id
       WHERE s.id = $1 AND s.status = 'ACTIVE'`, [schoolId]);
    return result.rows[0] ?? { active: false };
  }

  async managementSchool(schoolId:string) {
    const result = await this.pool.query(`SELECT id,school_code AS "schoolCode",display_name AS "displayName",timezone,status FROM schools WHERE id=$1`,[schoolId]);
    if(!result.rowCount) throw new NotFoundException({code:'SCHOOL_NOT_FOUND'});
    return result.rows[0];
  }

  async schools() {
    const result = await this.pool.query(
      `SELECT id, school_code AS "schoolCode", display_name AS "displayName", timezone, status, created_at AS "createdAt"
       FROM schools ORDER BY created_at DESC`);
    return result.rows;
  }

  async platformSummary() {
    const result = await this.pool.query(
      `SELECT s.id AS "schoolId", s.school_code AS "schoolCode", s.display_name AS "displayName", s.status,
              count(st.id) FILTER (WHERE st.status='ACTIVE')::integer AS "activeStudentCount",
              count(st.id)::integer AS "totalStudentCount"
       FROM schools s LEFT JOIN students st ON st.school_id=s.id
       GROUP BY s.id ORDER BY s.display_name`);
    return result.rows;
  }

  async createSchool(input: { schoolCode?: string; displayName: string; timezone: string }, actorUserId?: string, correlationId?: string) {
    const schoolCode = input.schoolCode?.trim().toUpperCase() || generatedCode('SCH');
    const displayName = input.displayName?.trim();
    if (!/^[A-Z0-9_-]{2,40}$/.test(schoolCode) || !displayName || displayName.length > 200 || !input.timezone) {
      throw new BadRequestException({ code: 'SCHOOL_VALIDATION_FAILED' });
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(); }
    catch { throw new BadRequestException({ code: 'TIMEZONE_INVALID' }); }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string; schoolCode: string; displayName: string; timezone: string; status: string }>(
        `INSERT INTO schools (school_code, display_name, timezone)
         VALUES ($1,$2,$3) ON CONFLICT (school_code) DO NOTHING
         RETURNING id, school_code AS "schoolCode", display_name AS "displayName", timezone, status`,
        [schoolCode, displayName, input.timezone]);
      if (inserted.rowCount) {
        const school = inserted.rows[0]!;
        await client.query('INSERT INTO school_configurations (school_id) VALUES ($1)', [school.id]);
        await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
          [domainEventTypes.schoolCreated, school.id, { schoolId: school.id, schoolCode, actorUserId, correlationId }]);
        await client.query('COMMIT');
        return { ...school, created: true };
      }
      const existing = await client.query<{ id: string; schoolCode: string; displayName: string; timezone: string; status: string }>(
        `SELECT id, school_code AS "schoolCode", display_name AS "displayName", timezone, status FROM schools WHERE school_code=$1`,
        [schoolCode]);
      const school = existing.rows[0]!;
      if (school.displayName !== displayName || school.timezone !== input.timezone) throw new ConflictException({ code: 'SCHOOL_CODE_ALREADY_EXISTS' });
      await client.query('COMMIT');
      return { ...school, created: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async classes(schoolId: string,includeArchived=false) {
    const result = await this.pool.query(
      `SELECT id, class_code AS "classCode", display_name AS "displayName", academic_year AS "academicYear", grade_code AS "gradeCode", status
       FROM school_classes WHERE school_id=$1 AND ($2 OR status='ACTIVE') ORDER BY display_name`,
      [schoolId,includeArchived]);
    return result.rows;
  }

  async updateSchool(schoolId: string, input: { displayName?: string; timezone?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' }, actorUserId?: string, correlationId?: string) {
    if (input.timezone) try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(); } catch { throw new BadRequestException({ code: 'TIMEZONE_INVALID' }); }
    if (input.displayName !== undefined && (!input.displayName.trim() || input.displayName.trim().length > 200)) throw new BadRequestException({ code: 'SCHOOL_NAME_INVALID' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE schools SET display_name=COALESCE($2,display_name), timezone=COALESCE($3,timezone), status=COALESCE($4,status), updated_at=now()
         WHERE id=$1 RETURNING id, school_code AS "schoolCode", display_name AS "displayName", timezone, status`,
        [schoolId, input.displayName?.trim() ?? null, input.timezone ?? null, input.status ?? null]);
      if (!result.rowCount) throw new BadRequestException({ code: 'SCHOOL_NOT_FOUND' });
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.schoolUpdated, schoolId, { schoolId, changedFields: Object.keys(input), status: result.rows[0].status, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateClass(schoolId: string, classId: string, input: { classCode?: string; displayName?: string; academicYear?:string; gradeCode?: string; status?: 'ACTIVE' | 'ARCHIVED' }, actorUserId?: string, correlationId?: string) {
    if(input.academicYear !== undefined && !/^\d{4}-\d{4}$/.test(input.academicYear)) throw new BadRequestException({code:'ACADEMIC_YEAR_INVALID'});
    if ([input.classCode, input.displayName, input.gradeCode].some((value) => value !== undefined && typeof value !== 'string')) throw new BadRequestException({ code: 'CLASS_VALIDATION_FAILED' });
    const classCode = input.classCode?.trim().toUpperCase();
    const displayName = input.displayName?.trim();
    if ((input.classCode !== undefined && !/^[A-Z0-9_-]{1,40}$/.test(classCode ?? '')) ||
        (input.displayName !== undefined && (!displayName || displayName.length > 120)) ||
        (input.gradeCode !== undefined && !/^[A-Z0-9_-]{0,40}$/.test(input.gradeCode.trim().toUpperCase())) ||
        (input.status !== undefined && !['ACTIVE', 'ARCHIVED'].includes(input.status))) {
      throw new BadRequestException({ code: 'CLASS_VALIDATION_FAILED' });
    }
    try {
      return await this.mutateWithEvent(domainEventTypes.classUpserted, classId, { schoolId, classId, changedFields: Object.keys(input), actorUserId, correlationId }, async (client) => {
        const result = await client.query(`UPDATE school_classes SET class_code=COALESCE($3,class_code),display_name=COALESCE($4,display_name),
          grade_code=CASE WHEN $5::text IS NULL THEN grade_code ELSE NULLIF($5,'') END,status=COALESCE($6,status),academic_year=COALESCE($7,academic_year)
          WHERE school_id=$1 AND id=$2 RETURNING id,class_code AS "classCode",display_name AS "displayName",grade_code AS "gradeCode",academic_year AS "academicYear",status`,
          [schoolId, classId, classCode ?? null, displayName ?? null, input.gradeCode?.trim().toUpperCase() ?? null, input.status ?? null,input.academicYear ?? null]);
        if (!result.rowCount) throw new NotFoundException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException({ code: 'CLASS_CODE_ALREADY_EXISTS' });
      throw error;
    }
  }

  async createClass(input: { schoolId: string; classCode?: string; displayName: string; academicYear: string; gradeCode?: string }, actorUserId?: string, correlationId?: string) {
    const classCode = input.classCode?.trim().toUpperCase() || generatedCode('CLS');
    const displayName = input.displayName?.trim();
    if (!/^[A-Z0-9_-]{1,40}$/.test(classCode) || !displayName || !/^\d{4}-\d{4}$/.test(input.academicYear)) {
      throw new BadRequestException({ code: 'CLASS_VALIDATION_FAILED' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO school_classes (school_id, class_code, display_name, academic_year, grade_code)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (school_id, class_code, academic_year)
         DO UPDATE SET display_name=excluded.display_name, grade_code=excluded.grade_code, status='ACTIVE'
         RETURNING id, class_code AS "classCode", display_name AS "displayName", academic_year AS "academicYear", grade_code AS "gradeCode", status`,
        [input.schoolId, classCode, displayName, input.academicYear, input.gradeCode?.trim().toUpperCase() || null]);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.classUpserted, result.rows[0].id, { schoolId: input.schoolId, classId: result.rows[0].id,
          classCode, academicYear: input.academicYear, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async assignTeacher(input: { schoolId: string; teacherMembershipId: string; classId: string; subjectCode?: string; subjectName: string; canPublishResults: boolean; canPublishAnnouncements: boolean; canRecordAttendance: boolean; canPublishSchoolWide?: boolean; canPublishGradeWide?: boolean; canPublishUrgent?: boolean }, actorUserId?: string, correlationId?: string) {
    const subjectCode = input.subjectCode?.trim().toUpperCase() || subjectCodeFor(input.subjectName ?? '');
    if (!input.subjectName?.trim()) throw new BadRequestException({ code: 'SUBJECT_REQUIRED' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const classExists = await client.query(
        `SELECT 1 FROM school_classes WHERE id=$1 AND school_id=$2 AND status='ACTIVE' FOR UPDATE`,
        [input.classId, input.schoolId]);
      if (!classExists.rowCount) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
      const result = await client.query<{ assignmentId: string }>(
      `INSERT INTO teacher_assignments
         (school_id, teacher_membership_id, class_id, subject_code, subject_name, can_publish_results, can_publish_announcements, can_record_attendance, can_publish_school_wide, can_publish_grade_wide,can_publish_urgent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (teacher_membership_id, class_id, subject_code)
       DO UPDATE SET subject_name=excluded.subject_name, can_publish_results=excluded.can_publish_results,
                     can_publish_announcements=excluded.can_publish_announcements,
                     can_record_attendance=excluded.can_record_attendance,
                     can_publish_school_wide=excluded.can_publish_school_wide,
                     can_publish_grade_wide=excluded.can_publish_grade_wide,can_publish_urgent=excluded.can_publish_urgent, status='ACTIVE'
      RETURNING id AS "assignmentId", class_id AS "classId", subject_code AS "subjectCode", subject_name AS "subjectName",
                 can_publish_results AS "canPublishResults", can_publish_announcements AS "canPublishAnnouncements",
                 can_record_attendance AS "canRecordAttendance", can_publish_school_wide AS "canPublishSchoolWide",
                 can_publish_grade_wide AS "canPublishGradeWide",can_publish_urgent AS "canPublishUrgent", status`,
      [input.schoolId, input.teacherMembershipId, input.classId, subjectCode, input.subjectName.trim(), input.canPublishResults, input.canPublishAnnouncements, input.canRecordAttendance, input.canPublishSchoolWide ?? false, input.canPublishGradeWide ?? false,input.canPublishUrgent ?? false]);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.teacherAssigned, result.rows[0]!.assignmentId, { schoolId: input.schoolId, assignmentId: result.rows[0]!.assignmentId,
          teacherMembershipId: input.teacherMembershipId, classId: input.classId, subjectCode, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async createStudentAndGuardian(input: { schoolId: string; classId: string; guardianUserId: string; admissionNumber?: string; studentDisplayName: string; relationship?: string; academicStartDate?: string }, actorUserId?: string, correlationId?: string) {
    const admissionNumber = input.admissionNumber?.trim().toUpperCase() || generatedCode('STU');
    const studentDisplayName = input.studentDisplayName?.trim();
    if (!input.guardianUserId || !/^[A-Z0-9_-]{1,80}$/.test(admissionNumber) || !studentDisplayName || studentDisplayName.length > 160) throw new BadRequestException({ code: 'STUDENT_GUARDIAN_VALIDATION_FAILED' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const classRow = await client.query(`SELECT 1 FROM school_classes WHERE id=$1 AND school_id=$2 AND status='ACTIVE' FOR UPDATE`, [input.classId, input.schoolId]);
      if (!classRow.rowCount) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
      const student = await client.query<{ id: string }>(
        `INSERT INTO students (school_id,admission_number,display_name) VALUES ($1,$2,$3)
         ON CONFLICT (school_id,admission_number) DO UPDATE SET display_name=excluded.display_name,status='ACTIVE',updated_at=now() RETURNING id`,
        [input.schoolId, admissionNumber, studentDisplayName]);
      const studentId = student.rows[0]!.id;
      await client.query(`UPDATE enrollments SET status='ENDED',ended_on=CURRENT_DATE WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE' AND class_id<>$3`, [input.schoolId, studentId, input.classId]);
      await client.query(
        `INSERT INTO enrollments (school_id,class_id,student_id,started_on) VALUES ($1,$2,$3,$4)
         ON CONFLICT (class_id,student_id,started_on) DO UPDATE SET status='ACTIVE',ended_on=NULL`,
        [input.schoolId, input.classId, studentId, input.academicStartDate ?? new Date().toISOString().slice(0, 10)]);
      const link = await client.query<{ id: string }>(
        `INSERT INTO guardian_links (school_id,guardian_user_id,student_id,relationship) VALUES ($1,$2,$3,$4)
         ON CONFLICT (school_id,guardian_user_id,student_id) DO UPDATE SET relationship=excluded.relationship,status='ACTIVE',valid_until=NULL RETURNING id`,
        [input.schoolId, input.guardianUserId, studentId, input.relationship?.trim() || 'Guardian']);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.guardianLinked, studentId, { schoolId: input.schoolId, studentId, guardianUserId: input.guardianUserId, classId: input.classId, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return { studentId, guardianLinkId: link.rows[0]!.id, admissionNumber, displayName: studentDisplayName, classId: input.classId };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async claimOutbox(limit: number) { return new PgOutbox(this.pool).claim(limit); }
  async renewOutbox(id: string, token: string) { return new PgOutbox(this.pool).renew(id,token); }
  async completeOutbox(id: string, success: boolean, token?: string, errorCode?: string) { return new PgOutbox(this.pool).complete(id,success,token,errorCode); }
  async eventingDiagnostics() { return { runtime:eventingStatus('publisher:school','consumer:schoolconnect-school-identity-v1'),outbox:await new PgOutbox(this.pool).status(),failures:await this.failures.list(),failureCounts:await this.failures.counts() }; }

  async feeRoster(schoolId: string, input: { admissionNumbers?: string[]; grade?: string }) {
    if (input.grade !== undefined && !/^(?:[1-9]|1[0-2])$/.test(input.grade) || input.admissionNumbers !== undefined && (!Array.isArray(input.admissionNumbers) || input.admissionNumbers.length > 200 || input.admissionNumbers.some((number) => typeof number !== 'string' || number.length > 120))) throw new BadRequestException({ code:'FEE_ROSTER_FILTER_INVALID' });
    if (!input.grade && !input.admissionNumbers) throw new BadRequestException({ code:'FEE_ROSTER_FILTER_REQUIRED' });
    const result = await this.pool.query(`SELECT DISTINCT st.id,st.admission_number AS "admissionNumber",st.display_name AS "displayName",st.status FROM students st WHERE st.school_id=$1 AND ($2::text[] IS NULL OR upper(st.admission_number)=ANY($2::text[])) AND ($3::text IS NULL OR st.status='ACTIVE' AND EXISTS(SELECT 1 FROM enrollments e JOIN school_classes c ON c.school_id=e.school_id AND c.id=e.class_id WHERE e.school_id=st.school_id AND e.student_id=st.id AND e.status='ACTIVE' AND c.status='ACTIVE' AND upper(c.grade_code)=ANY($4::text[]))) LIMIT 20001`, [schoolId,input.admissionNumbers?.map((number) => number.toUpperCase()) ?? null,input.grade ?? null,input.grade ? [input.grade,`G${input.grade}`,`GRADE_${input.grade}`,`GRADE-${input.grade}`] : []]);
    if (result.rows.length > 20000) throw new BadRequestException({ code:'FEE_GRADE_ROSTER_TOO_LARGE' });
    return result.rows;
  }

  async students(schoolId: string) {
    const result = await this.pool.query(
      `SELECT st.id,st.admission_number AS "admissionNumber",st.display_name AS "displayName",st.status,
              c.id AS "classId",c.display_name AS "className",COUNT(g.id)::int AS "guardianCount"
       FROM students st LEFT JOIN enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='ACTIVE'
       LEFT JOIN school_classes c ON c.id=e.class_id LEFT JOIN guardian_links g ON g.school_id=st.school_id AND g.student_id=st.id AND g.status='ACTIVE'
       WHERE st.school_id=$1 GROUP BY st.id,c.id ORDER BY st.display_name LIMIT 500`, [schoolId]);
    return result.rows;
  }

  async children(schoolId: string, guardianUserId: string) {
    const result = await this.pool.query(
      `SELECT st.id, st.display_name AS "displayName", st.admission_number AS "admissionNumber",
              c.id AS "classId", c.display_name AS "className", s.display_name AS "schoolName"
       FROM guardian_links g
       JOIN students st ON st.id = g.student_id AND st.school_id = g.school_id
       JOIN enrollments e ON e.student_id = st.id AND e.school_id = st.school_id AND e.status = 'ACTIVE'
       JOIN school_classes c ON c.id = e.class_id
       JOIN schools s ON s.id = st.school_id
       WHERE g.school_id = $1 AND g.guardian_user_id = $2 AND g.status = 'ACTIVE' AND st.status = 'ACTIVE'
       ORDER BY st.display_name`, [schoolId, guardianUserId]);
    return result.rows;
  }

  async teachingScope(schoolId: string, membershipId: string) {
    const result = await this.pool.query(
      `SELECT a.id AS "assignmentId", c.id AS "classId", c.display_name AS "className",
              a.subject_code AS "subjectCode", a.subject_name AS "subjectName",
              a.can_publish_results AS "canPublishResults", a.can_publish_announcements AS "canPublishAnnouncements",
              a.can_record_attendance AS "canRecordAttendance", a.can_publish_school_wide AS "canPublishSchoolWide",
              a.can_publish_grade_wide AS "canPublishGradeWide",a.can_publish_urgent AS "canPublishUrgent"
       FROM teacher_assignments a JOIN school_classes c ON c.id = a.class_id
       WHERE a.school_id = $1 AND a.teacher_membership_id = $2 AND a.status = 'ACTIVE' AND c.status = 'ACTIVE'
       ORDER BY c.display_name, a.subject_name`, [schoolId, membershipId]);
    return result.rows;
  }

  async guardianAuthorized(schoolId: string, guardianUserId: string, studentId: string) {
    const result = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM guardian_links WHERE school_id=$1 AND guardian_user_id=$2 AND student_id=$3 AND status='ACTIVE') AS allowed`,
      [schoolId, guardianUserId, studentId]);
    return Boolean(result.rows[0]?.allowed);
  }

  async guardianIdentities(schoolId:string,guardianUserId:string,studentId:string) {
    if(!await this.guardianAuthorized(schoolId,guardianUserId,studentId)) return {allowed:false};
    const aliases=await this.pool.query<{previous_user_id:string}>(`SELECT previous_user_id FROM guardian_identity_aliases WHERE school_id=$1 AND student_id=$2 AND current_user_id=$3`,[schoolId,studentId,guardianUserId]);
    return {allowed:true,guardianUserIds:[guardianUserId,...aliases.rows.map((row)=>row.previous_user_id)]};
  }

  async teacherAuthorized(schoolId: string, membershipId: string, classId: string, capability: string) {
    const column = capability === 'RESULTS' ? 'can_publish_results' : capability === 'ANNOUNCEMENTS' ? 'can_publish_announcements' : 'can_record_attendance';
    const result = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM teacher_assignments a JOIN school_classes c ON c.id=a.class_id AND c.school_id=a.school_id
        WHERE a.school_id=$1 AND a.teacher_membership_id=$2 AND a.class_id=$3 AND a.status='ACTIVE' AND c.status='ACTIVE' AND a.${column}=true) AS allowed`,
      [schoolId, membershipId, classId]);
    return Boolean(result.rows[0]?.allowed);
  }

  async roster(schoolId: string, classId: string) {
    const result = await this.pool.query(
      `SELECT st.id, st.display_name AS "displayName", st.admission_number AS "admissionNumber"
       FROM enrollments e JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
       WHERE e.school_id=$1 AND e.class_id=$2 AND e.status='ACTIVE' AND st.status='ACTIVE' ORDER BY st.display_name`,
      [schoolId, classId]);
    return result.rows;
  }

  async recipients(schoolId: string, classId: string) {
    const result = await this.pool.query(
      `SELECT st.id AS "studentId", g.guardian_user_id AS "guardianUserId",
              jsonb_build_object('studentName', st.display_name, 'admissionNumber', st.admission_number, 'classId', e.class_id) AS snapshot
       FROM enrollments e
       JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
       JOIN guardian_links g ON g.student_id=st.id AND g.school_id=st.school_id AND g.status='ACTIVE'
       WHERE e.school_id=$1 AND e.class_id=$2 AND e.status='ACTIVE' AND st.status='ACTIVE'
       ORDER BY st.display_name, g.guardian_user_id`, [schoolId, classId]);
    return result.rows;
  }

  async schoolAnnouncementRecipients(schoolId: string) {
    const result = await this.pool.query(`SELECT DISTINCT ON (st.id,g.guardian_user_id)
      st.id AS "studentId",g.guardian_user_id AS "guardianUserId",
      jsonb_build_object('studentName',st.display_name,'classId',c.id) AS snapshot
      FROM schools s JOIN school_classes c ON c.school_id=s.id AND c.status='ACTIVE'
      JOIN enrollments e ON e.school_id=s.id AND e.class_id=c.id AND e.status='ACTIVE'
      JOIN students st ON st.id=e.student_id AND st.school_id=s.id AND st.status='ACTIVE'
      JOIN guardian_links g ON g.school_id=s.id AND g.student_id=st.id AND g.status='ACTIVE'
      WHERE s.id=$1 AND s.status='ACTIVE'
      ORDER BY st.id,g.guardian_user_id,c.id`,[schoolId]);
    return result.rows;
  }

  async audienceRecipients(schoolId: string, classId: string, audienceType: 'CLASS' | 'GRADE' | 'SCHOOL') {
    const result = await this.pool.query(
      `SELECT st.id AS "studentId",g.guardian_user_id AS "guardianUserId",
              jsonb_build_object('studentName',st.display_name,'admissionNumber',st.admission_number,'classId',e.class_id) AS snapshot
       FROM school_classes selected
       JOIN school_classes c ON c.school_id=selected.school_id AND c.status='ACTIVE'
       JOIN enrollments e ON e.class_id=c.id AND e.school_id=c.school_id AND e.status='ACTIVE'
       JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id AND st.status='ACTIVE'
       JOIN guardian_links g ON g.student_id=st.id AND g.school_id=st.school_id AND g.status='ACTIVE'
       WHERE selected.id=$2 AND selected.school_id=$1 AND selected.status='ACTIVE'
         AND ($3='SCHOOL' OR ($3='GRADE' AND selected.grade_code IS NOT NULL AND c.grade_code=selected.grade_code) OR ($3='CLASS' AND c.id=selected.id))
       ORDER BY st.display_name,g.guardian_user_id`, [schoolId, classId, audienceType]);
    return result.rows;
  }

  async updateConfiguration(schoolId: string, input: { scheduledAnnouncementsEnabled?: boolean; schoolWideAnnouncementsEnabled?: boolean; gradeWideAnnouncementsEnabled?: boolean; urgentAnnouncementsEnabled?: boolean }, actorUserId?: string, correlationId?: string) {
    return this.mutateWithEvent(domainEventTypes.configurationUpdated, schoolId, { schoolId, changedFields: Object.keys(input), actorUserId, correlationId }, async (client) => {
    const result = await client.query(
      `UPDATE school_configurations SET scheduled_announcements_enabled=COALESCE($2,scheduled_announcements_enabled),
       school_wide_announcements_enabled=COALESCE($3,school_wide_announcements_enabled),
       grade_wide_announcements_enabled=COALESCE($4,grade_wide_announcements_enabled),urgent_announcements_enabled=COALESCE($5,urgent_announcements_enabled),updated_at=now()
       WHERE school_id=$1 RETURNING scheduled_announcements_enabled AS "scheduledAnnouncementsEnabled",
       school_wide_announcements_enabled AS "schoolWideAnnouncementsEnabled",grade_wide_announcements_enabled AS "gradeWideAnnouncementsEnabled",urgent_announcements_enabled AS "urgentAnnouncementsEnabled"`,
      [schoolId, input.scheduledAnnouncementsEnabled ?? null, input.schoolWideAnnouncementsEnabled ?? null, input.gradeWideAnnouncementsEnabled ?? null,input.urgentAnnouncementsEnabled ?? null]);
    if (!result.rowCount) throw new NotFoundException({ code: 'SCHOOL_NOT_FOUND' });
    return result.rows[0];
    });
  }

  async updateStudent(schoolId: string, studentId: string, input: { displayName?: string; admissionNumber?:string; status?: 'ACTIVE' | 'INACTIVE' | 'GRADUATED'; classId?: string }, actorUserId?: string, correlationId?: string) {
    if(input.admissionNumber !== undefined && !/^[A-Z0-9_-]{1,80}$/.test(input.admissionNumber.trim().toUpperCase())) throw new BadRequestException({code:'ADMISSION_NUMBER_INVALID'});
    if (input.displayName !== undefined && (!input.displayName.trim() || input.displayName.length > 160)) throw new BadRequestException({ code: 'STUDENT_NAME_INVALID' });
    if (input.status && !['ACTIVE','INACTIVE','GRADUATED'].includes(input.status)) throw new BadRequestException({ code: 'STUDENT_STATUS_INVALID' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(`SELECT id FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE`, [schoolId, studentId]);
      if (!current.rowCount) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
      if (input.classId) {
        const target = await client.query(`SELECT id FROM school_classes WHERE school_id=$1 AND id=$2 AND status='ACTIVE'`, [schoolId, input.classId]);
        if (!target.rowCount) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
      }
      const result = await client.query(
        `UPDATE students SET display_name=COALESCE($3,display_name),status=COALESCE($4,status),admission_number=COALESCE($5,admission_number),updated_at=now()
         WHERE school_id=$1 AND id=$2 RETURNING id,display_name AS "displayName",status`,
        [schoolId, studentId, input.displayName?.trim() ?? null, input.status ?? null,input.admissionNumber?.trim().toUpperCase() ?? null]);
      if (input.classId || (input.status && input.status !== 'ACTIVE')) {
        await client.query(`UPDATE enrollments SET status='ENDED',ended_on=CURRENT_DATE WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE'`, [schoolId, studentId]);
      }
      if (input.classId && (!input.status || input.status === 'ACTIVE')) {
        await client.query(`INSERT INTO enrollments (school_id,class_id,student_id,started_on) VALUES ($1,$2,$3,CURRENT_DATE)
          ON CONFLICT (class_id,student_id,started_on) DO UPDATE SET status='ACTIVE',ended_on=NULL`, [schoolId, input.classId, studentId]);
      }
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.studentUpdated,studentId,{ schoolId,studentId,changedFields:Object.keys(input),classId:input.classId,status:result.rows[0].status,actorUserId,correlationId }]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateGuardianLink(schoolId: string, studentId: string, guardianUserId: string, active: boolean, relationship = 'Guardian', actorUserId?: string, correlationId?: string) {
    return this.mutateWithEvent(domainEventTypes.guardianLinkUpdated, studentId, { schoolId,studentId,guardianUserId,active,actorUserId,correlationId }, async (client) => {
    const student = await client.query(`SELECT 1 FROM students WHERE school_id=$1 AND id=$2`, [schoolId, studentId]);
    if (!student.rowCount) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    const result = await client.query(
      `INSERT INTO guardian_links (school_id,student_id,guardian_user_id,relationship,status,valid_until)
       VALUES ($1,$2,$3,$4,$5::varchar,CASE WHEN $5::varchar='REVOKED' THEN now() ELSE NULL END)
       ON CONFLICT (school_id,guardian_user_id,student_id) DO UPDATE SET relationship=excluded.relationship,status=excluded.status,valid_until=excluded.valid_until
       RETURNING id,status`, [schoolId, studentId, guardianUserId, relationship, active ? 'ACTIVE' : 'REVOKED']);
    return result.rows[0];
    });
  }

  async revokeGuardianLinks(schoolId: string, guardianUserId: string, actorUserId?: string, correlationId?: string) {
    return this.mutateWithEvent(domainEventTypes.guardianLinksRevoked, guardianUserId, { schoolId,guardianUserId,actorUserId,correlationId }, async (client) => {
    const result = await client.query(`UPDATE guardian_links SET status='REVOKED',valid_until=now() WHERE school_id=$1 AND guardian_user_id=$2 AND status='ACTIVE'`, [schoolId, guardianUserId]);
    return { revokedLinks: result.rowCount ?? 0 };
    });
  }

  async assignments(schoolId: string, membershipId: string) {
    const result = await this.pool.query(`SELECT a.id AS "assignmentId",a.class_id AS "classId",c.display_name AS "className",a.subject_code AS "subjectCode",a.subject_name AS "subjectName",
      a.can_publish_results AS "canPublishResults",a.can_publish_announcements AS "canPublishAnnouncements",a.can_record_attendance AS "canRecordAttendance",
      a.can_publish_school_wide AS "canPublishSchoolWide",a.can_publish_grade_wide AS "canPublishGradeWide",a.can_publish_urgent AS "canPublishUrgent",a.status
      FROM teacher_assignments a JOIN school_classes c ON c.id=a.class_id WHERE a.school_id=$1 AND a.teacher_membership_id=$2 ORDER BY c.display_name,a.subject_name`, [schoolId, membershipId]);
    return result.rows;
  }

  async updateAssignment(schoolId: string, assignmentId: string, input: { classId?: string; subjectName?:string; status?: 'ACTIVE' | 'REVOKED'; canPublishResults?: boolean; canPublishAnnouncements?: boolean; canRecordAttendance?: boolean; canPublishSchoolWide?: boolean; canPublishGradeWide?: boolean; canPublishUrgent?: boolean }, actorUserId?: string, correlationId?: string) {
    if(input.subjectName !== undefined && (!input.subjectName.trim() || input.subjectName.length>120)) throw new BadRequestException({code:'SUBJECT_REQUIRED'});
    return this.mutateWithEvent(domainEventTypes.teacherAssignmentUpdated, assignmentId, { schoolId,assignmentId,changedFields:Object.keys(input),actorUserId,correlationId }, async (client) => {
    if (input.classId) {
      const target = await client.query(`SELECT 1 FROM school_classes WHERE school_id=$1 AND id=$2 AND status='ACTIVE'`, [schoolId, input.classId]);
      if (!target.rowCount) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
    }
    const result = await client.query(
      `UPDATE teacher_assignments SET class_id=COALESCE($3,class_id),status=COALESCE($4,status),
       can_publish_results=COALESCE($5,can_publish_results),can_publish_announcements=COALESCE($6,can_publish_announcements),
       can_record_attendance=COALESCE($7,can_record_attendance),can_publish_school_wide=COALESCE($8,can_publish_school_wide),
       can_publish_grade_wide=COALESCE($9,can_publish_grade_wide),can_publish_urgent=COALESCE($10,can_publish_urgent),subject_name=COALESCE($11,subject_name)
       WHERE school_id=$1 AND id=$2 RETURNING id AS "assignmentId",teacher_membership_id AS "teacherMembershipId",class_id AS "classId",status`,
      [schoolId, assignmentId, input.classId ?? null, input.status ?? null, input.canPublishResults ?? null, input.canPublishAnnouncements ?? null, input.canRecordAttendance ?? null, input.canPublishSchoolWide ?? null, input.canPublishGradeWide ?? null,input.canPublishUrgent ?? null,input.subjectName?.trim() ?? null]);
    if (!result.rowCount) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND' });
    return result.rows[0];
    });
  }

  async revokeTeacherAssignments(schoolId: string, membershipId: string, actorUserId?: string, correlationId?: string) {
    return this.mutateWithEvent(domainEventTypes.teacherAssignmentsRevoked, membershipId, { schoolId,teacherMembershipId:membershipId,actorUserId,correlationId }, async (client) => {
    const result = await client.query(`UPDATE teacher_assignments SET status='REVOKED' WHERE school_id=$1 AND teacher_membership_id=$2 AND status='ACTIVE'`, [schoolId, membershipId]);
    return { revokedAssignments: result.rowCount ?? 0 };
    });
  }

  async rollover(schoolId: string, fromYear: string, toYear: string, actorUserId?: string, correlationId?: string) {
    if (!/^\d{4}-\d{4}$/.test(fromYear) || !/^\d{4}-\d{4}$/.test(toYear) || fromYear === toYear) throw new BadRequestException({ code: 'ACADEMIC_YEAR_INVALID' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`rollover:${schoolId}`]);
      const source = await client.query<{ id: string; class_code: string; display_name: string; grade_code: string | null }>(
        `SELECT id,class_code,display_name,grade_code FROM school_classes WHERE school_id=$1 AND academic_year=$2 AND status='ACTIVE' ORDER BY id FOR UPDATE`, [schoolId, fromYear]);
      if (!source.rowCount) throw new BadRequestException({ code: 'SOURCE_YEAR_EMPTY' });
      const existing = await client.query(`SELECT 1 FROM school_classes WHERE school_id=$1 AND academic_year=$2 LIMIT 1`, [schoolId, toYear]);
      if (existing.rowCount) throw new ConflictException({ code: 'TARGET_YEAR_ALREADY_EXISTS' });
      for (const oldClass of source.rows) {
        const created = await client.query<{ id: string }>(`INSERT INTO school_classes (school_id,class_code,display_name,academic_year,grade_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [schoolId, oldClass.class_code, oldClass.display_name, toYear, oldClass.grade_code]);
        const newClassId = created.rows[0]!.id;
        await client.query(`WITH ended AS (
          UPDATE enrollments SET status='ENDED',ended_on=CURRENT_DATE WHERE school_id=$1 AND class_id=$2 AND status='ACTIVE'
          RETURNING school_id,student_id
        ) INSERT INTO enrollments (school_id,class_id,student_id,started_on)
          SELECT school_id,$3,student_id,CURRENT_DATE FROM ended`, [schoolId, oldClass.id, newClassId]);
        await client.query(`INSERT INTO teacher_assignments (school_id,teacher_membership_id,class_id,subject_code,subject_name,can_publish_results,can_publish_announcements,can_record_attendance,can_publish_school_wide,can_publish_grade_wide,can_publish_urgent)
          SELECT school_id,teacher_membership_id,$3,subject_code,subject_name,can_publish_results,can_publish_announcements,can_record_attendance,can_publish_school_wide,can_publish_grade_wide,can_publish_urgent
          FROM teacher_assignments WHERE school_id=$1 AND class_id=$2 AND status='ACTIVE'`, [schoolId, oldClass.id, newClassId]);
      }
      await client.query(`UPDATE school_classes SET status='ARCHIVED' WHERE school_id=$1 AND academic_year=$2 AND status='ACTIVE'`, [schoolId, fromYear]);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.academicYearRolledOver, schoolId, { schoolId, fromYear, toYear, classesCreated: source.rows.length, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return { fromYear, toYear, classesCreated: source.rows.length };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async guardiansForStudent(schoolId: string, studentId: string) {
    const result = await this.pool.query<{ guardianUserId: string }>(
      `SELECT guardian_user_id AS "guardianUserId" FROM guardian_links WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE'`, [schoolId, studentId]);
    return result.rows;
  }
  async guardianStudentLinks(schoolId:string,userId:string) {
    const result=await this.pool.query<{student_id:string}>(`SELECT student_id FROM guardian_links WHERE school_id=$1 AND guardian_user_id=$2 AND status='ACTIVE'`,[schoolId,userId]);
    return result.rows.map((row)=>row.student_id);
  }

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class SchoolController {
  constructor(@Inject(SchoolRepository) private readonly repository: SchoolRepository) {}
  @Post('schools/:schoolId/fee-roster') feeRoster(@Param('schoolId') schoolId: string, @Body() body: { admissionNumbers?: string[]; grade?: string }, @Headers('x-schoolconnect-school-id') scopedSchool?: string) { if (schoolId !== scopedSchool) throw new ForbiddenException({ code:'SCHOOL_SCOPE_REQUIRED' }); return this.repository.feeRoster(schoolId,body); }
  @Get('health') async health() { return { status:eventingHealth('publisher:school','consumer:schoolconnect-school-identity-v1'), service: 'school', database: await this.repository.health() }; }
  @Get('events/status') eventsStatus() { return this.repository.eventingDiagnostics(); }
  @Post('events/failures/:id/retry') async retry(@Param('id') id:string,@Headers('x-schoolconnect-user-id') actor?:string) {
    if(!actor) throw new ForbiddenException({code:'EVENT_REPLAY_ACTOR_REQUIRED'});
    try{return await this.repository.replayFailure(id,actor);}catch(error){if(error instanceof EventReplayError) throw new ConflictException({code:error.message});throw error;}
  }
  @Get('schools/:schoolId') school(@Param('schoolId') schoolId: string) { return this.repository.school(schoolId); }
  @Get('schools/:schoolId/management') management(@Param('schoolId') schoolId:string) { return this.repository.managementSchool(schoolId); }
  @Get('schools/:schoolId/announcement-recipients') announcementRecipients(@Param('schoolId') schoolId:string) { return this.repository.schoolAnnouncementRecipients(schoolId); }
  @Get('reports/platform-summary') platformSummary() { return this.repository.platformSummary(); }
  @Get('schools') schools() { return this.repository.schools(); }
  @Post('schools') createSchool(@Body() body: { schoolCode: string; displayName: string; timezone: string }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.createSchool(body, actorUserId, correlationId); }
  @Patch('schools/:schoolId') updateSchool(@Param('schoolId') schoolId: string, @Body() body: { displayName?: string; timezone?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateSchool(schoolId, body, actorUserId, correlationId); }
  @Get('schools/:schoolId/classes') classes(@Param('schoolId') schoolId: string,@Query('includeArchived') includeArchived?:string) { return this.repository.classes(schoolId,includeArchived==='true'); }
  @Patch('schools/:schoolId/classes/:classId') updateClass(@Param('schoolId') schoolId: string, @Param('classId') classId: string, @Body() body: Parameters<SchoolRepository['updateClass']>[2], @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateClass(schoolId, classId, body, actorUserId, correlationId); }
  @Post('schools/:schoolId/classes') createClass(@Param('schoolId') schoolId: string, @Body() body: { classCode: string; displayName: string; academicYear: string; gradeCode?: string }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.createClass({ ...body, schoolId }, actorUserId, correlationId); }
  @Patch('schools/:schoolId/configuration') configuration(@Param('schoolId') schoolId: string, @Body() body: Parameters<SchoolRepository['updateConfiguration']>[1], @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateConfiguration(schoolId, body, actorUserId, correlationId); }
  @Post('schools/:schoolId/academic-years/rollover') rollover(@Param('schoolId') schoolId: string, @Body() body: { fromYear: string; toYear: string }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.rollover(schoolId, body.fromYear, body.toYear, actorUserId, correlationId); }
  @Post('schools/:schoolId/teacher-assignments') assignTeacher(@Param('schoolId') schoolId: string, @Body() body: Omit<Parameters<SchoolRepository['assignTeacher']>[0], 'schoolId'>, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.assignTeacher({ ...body, schoolId }, actorUserId, correlationId); }
  @Get('schools/:schoolId/teachers/:membershipId/assignments') assignments(@Param('schoolId') schoolId: string, @Param('membershipId') membershipId: string) { return this.repository.assignments(schoolId, membershipId); }
  @Patch('schools/:schoolId/teacher-assignments/:assignmentId') updateAssignment(@Param('schoolId') schoolId: string, @Param('assignmentId') assignmentId: string, @Body() body: Parameters<SchoolRepository['updateAssignment']>[2], @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateAssignment(schoolId, assignmentId, body, actorUserId, correlationId); }
  @Post('schools/:schoolId/teachers/:membershipId/revoke-assignments') revokeAssignments(@Param('schoolId') schoolId: string, @Param('membershipId') membershipId: string, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.revokeTeacherAssignments(schoolId, membershipId, actorUserId, correlationId); }
  @Get('schools/:schoolId/students') students(@Param('schoolId') schoolId: string) { return this.repository.students(schoolId); }
  @Patch('schools/:schoolId/students/:studentId') updateStudent(@Param('schoolId') schoolId: string, @Param('studentId') studentId: string, @Body() body: Parameters<SchoolRepository['updateStudent']>[2], @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateStudent(schoolId, studentId, body, actorUserId, correlationId); }
  @Post('schools/:schoolId/students/:studentId/guardians/:guardianUserId/link') linkGuardian(@Param('schoolId') schoolId: string, @Param('studentId') studentId: string, @Param('guardianUserId') guardianUserId: string, @Body() body: { active: boolean; relationship?: string }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateGuardianLink(schoolId, studentId, guardianUserId, body.active, body.relationship, actorUserId, correlationId); }
  @Post('schools/:schoolId/guardians/:guardianUserId/revoke-links') revokeGuardianLinks(@Param('schoolId') schoolId: string, @Param('guardianUserId') guardianUserId: string, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.revokeGuardianLinks(schoolId, guardianUserId, actorUserId, correlationId); }
  @Post('schools/:schoolId/students-and-guardians') createStudentAndGuardian(@Param('schoolId') schoolId: string, @Body() body: Omit<Parameters<SchoolRepository['createStudentAndGuardian']>[0], 'schoolId'>, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.createStudentAndGuardian({ ...body, schoolId }, actorUserId, correlationId); }
  @Get('schools/:schoolId/guardians/:guardianUserId/children') children(@Param('schoolId') schoolId: string, @Param('guardianUserId') guardianUserId: string) { return this.repository.children(schoolId, guardianUserId); }
  @Get('schools/:schoolId/teachers/:membershipId/scope') scope(@Param('schoolId') schoolId: string, @Param('membershipId') membershipId: string) { return this.repository.teachingScope(schoolId, membershipId); }
  @Get('schools/:schoolId/classes/:classId/roster') roster(@Param('schoolId') schoolId: string, @Param('classId') classId: string) { return this.repository.roster(schoolId, classId); }
  @Get('schools/:schoolId/classes/:classId/recipients') recipients(@Param('schoolId') schoolId: string, @Param('classId') classId: string) { return this.repository.recipients(schoolId, classId); }
  @Get('schools/:schoolId/classes/:classId/audience-recipients') audienceRecipients(@Param('schoolId') schoolId: string, @Param('classId') classId: string, @Query('audienceType') audienceType: 'CLASS' | 'GRADE' | 'SCHOOL') { return this.repository.audienceRecipients(schoolId, classId, audienceType); }
  @Get('schools/:schoolId/students/:studentId/guardians') guardians(@Param('schoolId') schoolId: string, @Param('studentId') studentId: string) { return this.repository.guardiansForStudent(schoolId, studentId); }
  @Get('schools/:schoolId/guardians/:userId/student-links') guardianStudentLinks(@Param('schoolId') schoolId:string,@Param('userId') userId:string) {return this.repository.guardianStudentLinks(schoolId,userId);}
  @Get('authorization/guardian') async guardian(@Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId: string, @Query('studentId') studentId: string) { return this.repository.guardianIdentities(schoolId,guardianUserId,studentId); }
  @Get('authorization/teacher') async teacher(@Query('schoolId') schoolId: string, @Query('membershipId') membershipId: string, @Query('classId') classId: string, @Query('capability') capability = 'ATTENDANCE') { return { allowed: await this.repository.teacherAuthorized(schoolId, membershipId, classId, capability) }; }
  @Get('outbox') outbox(@Query('limit') limit = '25') { return this.repository.claimOutbox(Number(limit)); }
  @Post('outbox/:eventId/complete') completeOutbox(@Param('eventId') eventId: string, @Body() body: { success?: boolean; claimToken?: string }) { return this.repository.completeOutbox(eventId, body.success === true,body.claimToken); }
}

@Module({ controllers: [SchoolController], providers: [SchoolRepository] })
class SchoolModule {}

async function bootstrap() { const app = await NestFactory.create(SchoolModule); const token=process.env.INTERNAL_SERVICE_TOKEN; if (process.env.NODE_ENV==='production' && (!token || token.length<32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED'); if(token) app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'})); await app.listen(Number(process.env.SCHOOL_PORT ?? 3102), process.env.SERVICE_BIND_HOST ?? '127.0.0.1'); const repository=app.get(SchoolRepository); bindEventingShutdown(repository,await startOutboxPublisher('school',repository),await startEventConsumer('schoolconnect-school-identity-v1',(event)=>repository.consumeIdentity(event),{failureStore:repository.failures})); registerApplicationShutdown(app); }
if (process.env.SCHOOL_SKIP_BOOTSTRAP !== 'true') void bootstrap();
