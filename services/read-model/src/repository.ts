import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { PgConsumerFailures, parseEventEnvelope, eventingStatus, eventingHealth, type EventEnvelope } from '@schoolconnect/eventing';

type PostSnapshot = { id: string; schoolId: string; authorMembershipId: string; classId?: string | null; postType: string; status: string;
  publishedAt?: string | null; scheduledFor?: string | null; revisionNumber: number; title: string; body: string; subjectCode?: string | null;
  examName?: string | null; dueDate?: string | null; urgent?: boolean; attachments?: Array<{ fileId: string; studentId?: string | null; privacyClassification: string }> };
type Recipient = { guardianUserId: string; studentId: string };

@Injectable()
export class ReadRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.READ_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_read',
    max: Number(process.env.READ_DB_POOL_MAX ?? 8), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  async health() { await this.pool.query('SELECT 1 FROM read_posts LIMIT 1'); return { status:eventingHealth('consumer:schoolconnect-read-model-v1') }; }
  readonly failures=new PgConsumerFailures(this.pool,'schoolconnect-read-model-v1');
  async replayFailure(id: string, actorUserId: string) { return this.failures.replay(id,actorUserId,(raw) => this.consume(parseEventEnvelope(raw))); }
  async eventingDiagnostics() { return { runtime:eventingStatus('consumer:schoolconnect-read-model-v1'),failures:await this.failures.list(),failureCounts:await this.failures.counts() }; }

  private async legacyPost(event: EventEnvelope): Promise<PostSnapshot> {
    const schoolId = String(event.event.payload.schoolId ?? '');
    const response = await fetch(`${process.env.CONTENT_SERVICE_URL ?? 'http://127.0.0.1:3103'}/internal/v1/posts/${encodeURIComponent(event.event.aggregateId)}?schoolId=${encodeURIComponent(schoolId)}`, {
      headers: process.env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN } : {}, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`LEGACY_READ_MODEL_LOOKUP_${response.status}`);
    return response.json() as Promise<PostSnapshot>;
  }

  private async upsertPost(client: PoolClient, post: PostSnapshot, recipients: Recipient[]) {
    if (!post.id || !post.schoolId || !post.authorMembershipId || !post.postType || !post.title || !Number.isInteger(post.revisionNumber)) throw new Error('POST_PROJECTION_SNAPSHOT_INVALID');
    await client.query(`INSERT INTO read_posts (post_id,school_id,author_membership_id,class_id,post_type,status,published_at,scheduled_for,revision_number,title,body,subject_code,exam_name,due_date,urgent,attachments,recipient_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (post_id) DO UPDATE SET status=excluded.status,published_at=excluded.published_at,scheduled_for=excluded.scheduled_for,
        revision_number=excluded.revision_number,title=excluded.title,body=excluded.body,subject_code=excluded.subject_code,exam_name=excluded.exam_name,
        due_date=excluded.due_date,urgent=excluded.urgent,attachments=excluded.attachments,recipient_count=excluded.recipient_count,updated_at=now()
      WHERE read_posts.status<>'ARCHIVED' AND read_posts.revision_number<=excluded.revision_number`,
    [post.id,post.schoolId,post.authorMembershipId,post.classId ?? null,post.postType,post.status,post.publishedAt ?? null,
      post.scheduledFor ?? null,post.revisionNumber,post.title,post.body,post.subjectCode ?? null,post.examName ?? null,
      post.dueDate ?? null,post.urgent ?? false,JSON.stringify(post.attachments ?? []),recipients.length]);
    for (const recipient of recipients) {
      if (!recipient.guardianUserId || !recipient.studentId) throw new Error('POST_PROJECTION_RECIPIENT_INVALID');
      await client.query(`INSERT INTO read_post_recipients (post_id,school_id,guardian_user_id,student_id)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [post.id,post.schoolId,recipient.guardianUserId,recipient.studentId]);
    }
  }

  async consume(envelope: EventEnvelope) {
    const { event } = envelope;
    const postEvent = [domainEventTypes.postPublished,domainEventTypes.postScheduled,domainEventTypes.postUpdated,domainEventTypes.scheduledPostUpdated,domainEventTypes.postSnapshot].includes(event.eventType as typeof domainEventTypes.postPublished);
    const archiveEvent = event.eventType === domainEventTypes.postArchived;
    const attendanceEvent = event.eventType === domainEventTypes.attendanceRecorded || event.eventType === domainEventTypes.attendanceSnapshot;
    if (!postEvent && !archiveEvent && !attendanceEvent) return;
    const post = postEvent ? (event.payload.post as PostSnapshot | undefined) ?? await this.legacyPost(envelope) : undefined;
    const recipients = Array.isArray(event.payload.recipients) ? event.payload.recipients as Recipient[] : [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO consumed_events (event_id,event_type,aggregate_id,school_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id`, [event.id,event.eventType,event.aggregateId,event.payload.schoolId]);
      if (!inserted.rowCount) { await client.query('COMMIT'); return; }
      if (post) {
        if (post.id!==event.aggregateId || post.schoolId!==event.payload.schoolId) throw new Error('POST_PROJECTION_TENANT_INVALID');
        const archived=await client.query('SELECT 1 FROM consumed_events WHERE aggregate_id=$1 AND school_id=$2 AND event_type=$3 LIMIT 1', [post.id,post.schoolId,domainEventTypes.postArchived]);
        if (!archived.rowCount) await this.upsertPost(client, post, recipients);
      }
      if (archiveEvent) await client.query(`UPDATE read_posts SET status='ARCHIVED',updated_at=now() WHERE post_id=$1 AND school_id=$2`, [event.aggregateId,event.payload.schoolId]);
      if (attendanceEvent) {
        const p = event.payload;
        if (!p.schoolId || !p.classId || !p.studentId || !p.attendanceDate || !p.status) throw new Error('ATTENDANCE_PROJECTION_SNAPSHOT_INVALID');
        await client.query(`INSERT INTO read_attendance (school_id,class_id,student_id,attendance_date,event_id,attendance_status,occurred_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (school_id,student_id,attendance_date) DO UPDATE SET class_id=excluded.class_id,event_id=excluded.event_id,
            attendance_status=excluded.attendance_status,occurred_at=excluded.occurred_at
          WHERE read_attendance.occurred_at<=excluded.occurred_at`,
        [p.schoolId,p.classId,p.studentId,p.attendanceDate,event.aggregateId,p.status,event.occurredAt]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async parentTimeline(schoolId: string, guardianUserId: string, studentId: string, before?: string, limit = 50,guardianUserIds?:string[]) {
    const result = await this.pool.query(`SELECT DISTINCT p.post_id AS id,p.post_type AS "postType",p.status,p.published_at AS "publishedAt",p.scheduled_for AS "scheduledFor",
      p.revision_number AS "revisionNumber",p.title,p.body,p.subject_code AS "subjectCode",p.exam_name AS "examName",p.due_date AS "dueDate",p.urgent,p.attachments
      FROM read_post_recipients r JOIN read_posts p ON p.post_id=r.post_id
      WHERE r.school_id=$1 AND r.guardian_user_id=ANY($2::uuid[]) AND r.student_id=$3 AND p.status IN ('PUBLISHED','UPDATED')
        AND ($4::timestamptz IS NULL OR p.published_at<$4)
      ORDER BY p.published_at DESC,p.post_id DESC LIMIT $5`, [schoolId,guardianUserIds ?? [guardianUserId],studentId,before ?? null,Math.min(Math.max(limit,1),100)]);
    return result.rows.map((row: Record<string, unknown>) => ({ ...row, attachments: (row.attachments as PostSnapshot['attachments'] ?? [])
      .filter((attachment) => !attachment.studentId || attachment.studentId === studentId) }));
  }
  async teacherPosts(schoolId: string, authorMembershipId: string, before?: string, limit = 50) {
    const result = await this.pool.query(`SELECT post_id AS id,class_id AS "classId",post_type AS "postType",status,published_at AS "publishedAt",
      scheduled_for AS "scheduledFor",revision_number AS "revisionNumber",title,body,subject_code AS "subjectCode",exam_name AS "examName",
      due_date AS "dueDate",urgent,recipient_count AS "recipientCount" FROM read_posts
      WHERE school_id=$1 AND author_membership_id=$2 AND ($3::timestamptz IS NULL OR created_at<$3)
      ORDER BY created_at DESC,post_id DESC LIMIT $4`, [schoolId,authorMembershipId,before ?? null,Math.min(Math.max(limit,1),100)]);
    return result.rows;
  }
  async attendanceSummary(schoolId: string, fromDate: string, toDate: string) {
    const result = await this.pool.query(`SELECT class_id AS "classId",attendance_status AS status,COUNT(*)::int AS count
      FROM read_attendance WHERE school_id=$1 AND attendance_date BETWEEN $2 AND $3 GROUP BY class_id,attendance_status ORDER BY class_id,attendance_status`, [schoolId,fromDate,toDate]);
    return result.rows;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
