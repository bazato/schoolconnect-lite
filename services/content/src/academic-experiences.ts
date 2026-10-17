import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { domainEventTypes, validateTimetable, type TimetableSlot } from '@schoolconnect/contracts';

export class AcademicExperiences {
  constructor(private readonly pool: Pool) {}
  async timetable(schoolId:string,classId:string) {
    const result=await this.pool.query(`SELECT id,class_id AS "classId",version,title,slots,published_at AS "publishedAt"
      FROM class_timetables WHERE school_id=$1 AND class_id=$2 ORDER BY version DESC LIMIT 1`,[schoolId,classId]);return result.rows[0] ?? null;
  }
  async publishTimetable(input:{schoolId:string;classId:string;actorMembershipId:string;expectedVersion:number;title:string;slots:TimetableSlot[];recipients:Array<{studentId:string;guardianUserId:string}>;correlationId?:string}) {
    let slots:TimetableSlot[];
    try{slots=validateTimetable(input);}catch(error){throw new BadRequestException({code:error instanceof Error ? error.message : 'TIMETABLE_INVALID'});}
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${input.schoolId}:${input.classId}:timetable`]);
      const current=await client.query<{version:number;title:string;slots:TimetableSlot[]}>('SELECT version,title,slots FROM class_timetables WHERE school_id=$1 AND class_id=$2 ORDER BY version DESC LIMIT 1',[input.schoolId,input.classId]);
      const previous=current.rows[0];
      // An identical retry is safe even if the first response was lost.
      if(previous?.version===input.expectedVersion+1 && previous.title===input.title.trim() && JSON.stringify(validateTimetable({title:previous.title,expectedVersion:0,slots:previous.slots}))===JSON.stringify(slots)) {
        await client.query('COMMIT');return {version:previous.version};
      }
      if((previous?.version ?? 0)!==input.expectedVersion) throw new ConflictException({code:'TIMETABLE_VERSION_CONFLICT'});
      const id=randomUUID();const version=input.expectedVersion+1;
      await client.query('INSERT INTO class_timetables(id,school_id,class_id,version,title,slots,published_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,input.schoolId,input.classId,version,input.title.trim(),JSON.stringify(slots),input.actorMembershipId]);
      await client.query('INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES($1,$2,$3)',[domainEventTypes.timetablePublished,id,
        {schoolId:input.schoolId,classId:input.classId,actorMembershipId:input.actorMembershipId,version,recipients:input.recipients,correlationId:input.correlationId}]);
      await client.query('COMMIT');return {id,version};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async resultCharts(schoolId:string,scope:{studentId?:string;classId?:string;guardianUserIds?:string[]}) {
    if(!scope.studentId && !scope.classId) throw new BadRequestException({code:'RESULT_SCOPE_REQUIRED'});
    const result=await this.pool.query(`WITH eligible AS (
      SELECT DISTINCT ON (s.student_id,LOWER(s.exam_name),LOWER(s.subject_name)) s.*
      FROM result_scores s JOIN posts p ON p.id=s.post_id AND p.school_id=s.school_id
      WHERE s.school_id=$1 AND p.status IN ('PUBLISHED','UPDATED') AND p.current_revision_number=1
      AND ($2::uuid IS NULL OR s.student_id=$2) AND ($3::uuid IS NULL OR s.class_id=$3)
      AND ($4::uuid[] IS NULL OR EXISTS(SELECT 1 FROM post_recipients r WHERE r.post_id=s.post_id AND r.student_id=s.student_id AND r.guardian_user_id=ANY($4)))
      ORDER BY s.student_id,LOWER(s.exam_name),LOWER(s.subject_name),s.created_at DESC,s.post_id DESC
    ) SELECT MIN(s.exam_name) AS "examName",MIN(s.subject_name) AS "subjectName",
      ROUND(AVG(100*s.marks_obtained/s.max_marks),2)::float8 AS percentage,COUNT(*)::int AS count,MAX(s.result_date)::text AS "resultDate"
      FROM eligible s
      GROUP BY LOWER(s.exam_name),LOWER(s.subject_name) ORDER BY MAX(s.result_date) DESC NULLS LAST,LOWER(s.exam_name),LOWER(s.subject_name) LIMIT 200`,[schoolId,scope.studentId ?? null,scope.classId ?? null,scope.guardianUserIds ?? null]);
    // Revised text/PDF results cannot keep stale original marks in a chart.
    return {points:result.rows,description:scope.studentId ? 'Your child’s recorded scores (%)' : 'Class mean of recorded scores (%)',limitedToStructuredResults:true};
  }
}
