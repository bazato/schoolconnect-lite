import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { domainEventTypes, validateLeaveApplication } from '@schoolconnect/contracts';

export class LeaveApplications {
  constructor(private readonly pool: Pool) {}
  async submit(input: { schoolId: string; classId: string; studentId: string; guardianUserId: string; startDate: string; endDate: string; reason: string; teacherUserIds: string[]; correlationId?: string }) {
    try { validateLeaveApplication(input); } catch { throw new BadRequestException({code:'LEAVE_APPLICATION_INVALID'}); }
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${input.schoolId}:${input.studentId}:leave`]);
      // Exact retries are safe. A different reason for the same dates must not silently overwrite a sent application.
      const existing=await client.query('SELECT id,reason,status FROM parent_leave_applications WHERE school_id=$1 AND student_id=$2 AND guardian_user_id=$3 AND start_date=$4 AND end_date=$5',
        [input.schoolId,input.studentId,input.guardianUserId,input.startDate,input.endDate]);
      if(existing.rowCount) {
        if(existing.rows[0].reason!==input.reason.trim()) throw new ConflictException({code:'LEAVE_DATES_ALREADY_SUBMITTED'});
        await client.query('COMMIT');return existing.rows[0];
      }
      const id=randomUUID();
      await client.query(`INSERT INTO parent_leave_applications(id,school_id,class_id,student_id,guardian_user_id,start_date,end_date,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id,input.schoolId,input.classId,input.studentId,input.guardianUserId,input.startDate,input.endDate,input.reason.trim()]);
      // Leave reasons remain in Attendance, not in Kafka notification payloads.
      await client.query('INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES($1,$2,$3)',[domainEventTypes.leaveApplicationSubmitted,id,
        {schoolId:input.schoolId,classId:input.classId,studentId:input.studentId,actorUserId:input.guardianUserId,teacherUserIds:[...new Set(input.teacherUserIds)],correlationId:input.correlationId}]);
      await client.query('COMMIT');return {id,status:'SUBMITTED'};
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  async list(schoolId: string, scope: { classId?: string; studentId?: string }) {
    if(!scope.classId && !scope.studentId) throw new BadRequestException({code:'LEAVE_SCOPE_REQUIRED'});
    const result=await this.pool.query(`SELECT id,class_id AS "classId",student_id AS "studentId",start_date::text AS "startDate",end_date::text AS "endDate",reason,status,
      acknowledgement_note AS "acknowledgementNote",acknowledged_at AS "acknowledgedAt",created_at AS "createdAt"
      FROM parent_leave_applications WHERE school_id=$1 AND ($2::uuid IS NULL OR class_id=$2) AND ($3::uuid IS NULL OR student_id=$3)
      ORDER BY created_at DESC,id DESC LIMIT 200`,[schoolId,scope.classId ?? null,scope.studentId ?? null]);return result.rows;
  }
  async context(schoolId: string,id: string) {
    const result=await this.pool.query('SELECT class_id AS "classId",student_id AS "studentId" FROM parent_leave_applications WHERE school_id=$1 AND id=$2',[schoolId,id]);
    if(!result.rowCount) throw new NotFoundException({code:'LEAVE_APPLICATION_NOT_FOUND'});return result.rows[0] as {classId:string;studentId:string};
  }
  async acknowledge(schoolId: string,id: string,actorMembershipId: string,note: string,correlationId?: string) {
    if(typeof note!=='string' || note.length>1000) throw new BadRequestException({code:'LEAVE_NOTE_INVALID'});
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current=await client.query('SELECT * FROM parent_leave_applications WHERE school_id=$1 AND id=$2 FOR UPDATE',[schoolId,id]);
      if(!current.rowCount) throw new NotFoundException({code:'LEAVE_APPLICATION_NOT_FOUND'});
      const row=current.rows[0];
      if(row.status==='ACKNOWLEDGED') {await client.query('COMMIT');return {id,status:row.status};}
      await client.query(`UPDATE parent_leave_applications SET status='ACKNOWLEDGED',acknowledged_by_membership_id=$3,acknowledged_at=now(),acknowledgement_note=$4 WHERE school_id=$1 AND id=$2`,[schoolId,id,actorMembershipId,note.trim() || null]);
      await client.query('INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES($1,$2,$3)',[domainEventTypes.leaveApplicationAcknowledged,id,
        {schoolId,studentId:row.student_id,guardianUserId:row.guardian_user_id,actorMembershipId,correlationId}]);
      await client.query('COMMIT');return {id,status:'ACKNOWLEDGED'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
