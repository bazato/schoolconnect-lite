import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Module, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

@Injectable()
class SchoolRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.SCHOOL_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_school' });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  async school(schoolId: string) {
    const result = await this.pool.query(
      `SELECT s.id, s.school_code AS "schoolCode", s.display_name AS "displayName", s.timezone,
              c.attendance_edit_window_hours AS "attendanceEditWindowHours", c.guardian_ack_policy AS "guardianAckPolicy",
              c.result_release_policy AS "resultReleasePolicy", c.allowed_file_types AS "allowedFileTypes",
              c.max_file_bytes AS "maxFileBytes", c.max_files_per_post AS "maxFilesPerPost"
       FROM schools s JOIN school_configurations c ON c.school_id = s.id
       WHERE s.id = $1 AND s.status = 'ACTIVE'`, [schoolId]);
    return result.rows[0] ?? null;
  }

  async schools() {
    const result = await this.pool.query(
      `SELECT id, school_code AS "schoolCode", display_name AS "displayName", timezone, status, created_at AS "createdAt"
       FROM schools ORDER BY created_at DESC`);
    return result.rows;
  }

  async createSchool(input: { schoolCode: string; displayName: string; timezone: string }) {
    const schoolCode = input.schoolCode?.trim().toUpperCase();
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

  async classes(schoolId: string) {
    const result = await this.pool.query(
      `SELECT id, class_code AS "classCode", display_name AS "displayName", academic_year AS "academicYear", status
       FROM school_classes WHERE school_id=$1 AND status='ACTIVE' ORDER BY display_name`,
      [schoolId]);
    return result.rows;
  }

  async createClass(input: { schoolId: string; classCode: string; displayName: string; academicYear: string }) {
    const classCode = input.classCode?.trim().toUpperCase();
    const displayName = input.displayName?.trim();
    if (!/^[A-Z0-9_-]{1,40}$/.test(classCode) || !displayName || !/^\d{4}-\d{4}$/.test(input.academicYear)) {
      throw new BadRequestException({ code: 'CLASS_VALIDATION_FAILED' });
    }
    const result = await this.pool.query(
      `INSERT INTO school_classes (school_id, class_code, display_name, academic_year)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (school_id, class_code, academic_year)
       DO UPDATE SET display_name=excluded.display_name, status='ACTIVE'
       RETURNING id, class_code AS "classCode", display_name AS "displayName", academic_year AS "academicYear", status`,
      [input.schoolId, classCode, displayName, input.academicYear]);
    return result.rows[0];
  }

  async assignTeacher(input: { schoolId: string; teacherMembershipId: string; classId: string; subjectCode: string; subjectName: string; canPublishResults: boolean; canPublishAnnouncements: boolean; canRecordAttendance: boolean }) {
    const classExists = await this.pool.query(
      `SELECT 1 FROM school_classes WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`,
      [input.classId, input.schoolId]);
    if (!classExists.rowCount) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
    if (!input.subjectCode?.trim() || !input.subjectName?.trim()) throw new BadRequestException({ code: 'SUBJECT_REQUIRED' });
    const result = await this.pool.query(
      `INSERT INTO teacher_assignments
         (school_id, teacher_membership_id, class_id, subject_code, subject_name, can_publish_results, can_publish_announcements, can_record_attendance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (teacher_membership_id, class_id, subject_code)
       DO UPDATE SET subject_name=excluded.subject_name, can_publish_results=excluded.can_publish_results,
                     can_publish_announcements=excluded.can_publish_announcements,
                     can_record_attendance=excluded.can_record_attendance, status='ACTIVE'
       RETURNING id AS "assignmentId", class_id AS "classId", subject_code AS "subjectCode", subject_name AS "subjectName",
                 can_publish_results AS "canPublishResults", can_publish_announcements AS "canPublishAnnouncements",
                 can_record_attendance AS "canRecordAttendance", status`,
      [input.schoolId, input.teacherMembershipId, input.classId, input.subjectCode.trim().toUpperCase(), input.subjectName.trim(), input.canPublishResults, input.canPublishAnnouncements, input.canRecordAttendance]);
    return result.rows[0];
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
              a.can_record_attendance AS "canRecordAttendance"
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

  async teacherAuthorized(schoolId: string, membershipId: string, classId: string, capability: string) {
    const column = capability === 'RESULTS' ? 'can_publish_results' : capability === 'ANNOUNCEMENTS' ? 'can_publish_announcements' : 'can_record_attendance';
    const result = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM teacher_assignments WHERE school_id=$1 AND teacher_membership_id=$2 AND class_id=$3 AND status='ACTIVE' AND ${column}=true) AS allowed`,
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

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class SchoolController {
  constructor(@Inject(SchoolRepository) private readonly repository: SchoolRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'school', database: await this.repository.health() }; }
  @Get('schools/:schoolId') school(@Param('schoolId') schoolId: string) { return this.repository.school(schoolId); }
  @Get('schools') schools() { return this.repository.schools(); }
  @Post('schools') createSchool(@Body() body: { schoolCode: string; displayName: string; timezone: string }) { return this.repository.createSchool(body); }
  @Get('schools/:schoolId/classes') classes(@Param('schoolId') schoolId: string) { return this.repository.classes(schoolId); }
  @Post('schools/:schoolId/classes') createClass(@Param('schoolId') schoolId: string, @Body() body: { classCode: string; displayName: string; academicYear: string }) { return this.repository.createClass({ ...body, schoolId }); }
  @Post('schools/:schoolId/teacher-assignments') assignTeacher(@Param('schoolId') schoolId: string, @Body() body: Omit<Parameters<SchoolRepository['assignTeacher']>[0], 'schoolId'>) { return this.repository.assignTeacher({ ...body, schoolId }); }
  @Get('schools/:schoolId/guardians/:guardianUserId/children') children(@Param('schoolId') schoolId: string, @Param('guardianUserId') guardianUserId: string) { return this.repository.children(schoolId, guardianUserId); }
  @Get('schools/:schoolId/teachers/:membershipId/scope') scope(@Param('schoolId') schoolId: string, @Param('membershipId') membershipId: string) { return this.repository.teachingScope(schoolId, membershipId); }
  @Get('schools/:schoolId/classes/:classId/roster') roster(@Param('schoolId') schoolId: string, @Param('classId') classId: string) { return this.repository.roster(schoolId, classId); }
  @Get('schools/:schoolId/classes/:classId/recipients') recipients(@Param('schoolId') schoolId: string, @Param('classId') classId: string) { return this.repository.recipients(schoolId, classId); }
  @Get('authorization/guardian') async guardian(@Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId: string, @Query('studentId') studentId: string) { return { allowed: await this.repository.guardianAuthorized(schoolId, guardianUserId, studentId) }; }
  @Get('authorization/teacher') async teacher(@Query('schoolId') schoolId: string, @Query('membershipId') membershipId: string, @Query('classId') classId: string, @Query('capability') capability = 'ATTENDANCE') { return { allowed: await this.repository.teacherAuthorized(schoolId, membershipId, classId, capability) }; }
}

@Module({ controllers: [SchoolController], providers: [SchoolRepository] })
class SchoolModule {}

async function bootstrap() { const app = await NestFactory.create(SchoolModule); await app.listen(Number(process.env.SCHOOL_PORT ?? 3102), '127.0.0.1'); }
void bootstrap();
