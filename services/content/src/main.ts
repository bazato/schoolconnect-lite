import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { startOutboxPublisher } from '@schoolconnect/eventing';
import { ScheduledPostRunner } from './scheduled-runner';

type CreatePostRequest = {
  schoolId: string;
  actorUserId: string;
  authorMembershipId: string;
  classId?: string;
  postType: 'HOMEWORK' | 'RESULT' | 'ANNOUNCEMENT';
  title: string;
  body: string;
  subjectCode?: string;
  examName?: string;
  dueDate?: string;
  audienceType: 'CLASS' | 'GRADE' | 'SCHOOL' | 'STUDENT';
  urgent?: boolean;
  scheduledFor?: string;
  idempotencyKey: string;
  correlationId?: string;
  recipients: Array<{ studentId: string; guardianUserId: string; snapshot?: Record<string, unknown> }>;
  attachments?: Array<{ fileId: string; studentId?: string; privacyClassification: 'GENERAL' | 'STUDENT_PRIVATE' | 'APPROVED_CLASS_PUBLIC' }>;
};

type CreatePostRevisionRequest = {
  schoolId: string;
  actorUserId: string;
  authorMembershipId: string;
  expectedRevisionNumber: number;
  title: string;
  body: string;
  subjectCode?: string;
  examName?: string;
  dueDate?: string;
  urgent?: boolean;
  scheduledFor?: string;
  changeKind?: 'MATERIAL' | 'MINOR';
  correlationId?: string;
};

const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
class ContentRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.CONTENT_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_content', max: Number(process.env.CONTENT_DB_POOL_MAX ?? 10), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }
  async nextScheduledAt() {
    const result = await this.pool.query<{ nextAt: Date | null }>(`SELECT MIN(scheduled_for) AS "nextAt" FROM posts WHERE status='SCHEDULED'`);
    return result.rows[0]?.nextAt ?? null;
  }

  async timeline(schoolId: string, guardianUserId: string, studentId: string, before?: string, limit = 50) {
    const result = await this.pool.query(
      `SELECT p.id, p.post_type AS "postType", p.status, p.published_at AS "publishedAt",p.scheduled_for AS "scheduledFor",
              r.revision_number AS "revisionNumber", r.title, r.body, r.subject_code AS "subjectCode",
              r.exam_name AS "examName", r.due_date AS "dueDate", r.urgent,
              COALESCE(json_agg(json_build_object('fileId', a.file_id, 'studentId', a.student_id, 'privacyClassification', a.privacy_classification)) FILTER (WHERE a.id IS NOT NULL), '[]') AS attachments
       FROM post_recipients pr
       JOIN posts p ON p.id = pr.post_id
       JOIN post_revisions r ON r.post_id = p.id AND r.revision_number = p.current_revision_number
       LEFT JOIN post_attachments a ON a.post_revision_id = r.id AND (a.student_id IS NULL OR a.student_id = pr.student_id)
       WHERE pr.school_id = $1 AND pr.guardian_user_id = $2 AND pr.student_id = $3 AND p.status IN ('PUBLISHED','UPDATED')
         AND ($4::timestamptz IS NULL OR p.published_at<$4)
       GROUP BY p.id, r.id ORDER BY p.published_at DESC LIMIT $5`, [schoolId, guardianUserId, studentId, before ?? null, Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }

  async teacherPosts(schoolId: string, authorMembershipId: string, before?: string, limit = 50) {
    const result = await this.pool.query(
      `SELECT p.id,p.class_id AS "classId", p.post_type AS "postType", p.status, p.published_at AS "publishedAt",p.scheduled_for AS "scheduledFor",
              r.revision_number AS "revisionNumber", r.title, r.body, r.subject_code AS "subjectCode",
              r.exam_name AS "examName", r.due_date AS "dueDate", r.urgent,
              COUNT(pr.student_id)::integer AS "recipientCount"
       FROM posts p
       JOIN post_revisions r ON r.post_id = p.id AND r.revision_number = p.current_revision_number
       LEFT JOIN post_recipients pr ON pr.post_id = p.id
       WHERE p.school_id = $1 AND p.author_membership_id = $2 AND p.status IN ('PUBLISHED','UPDATED','ARCHIVED','SCHEDULED') AND ($3::timestamptz IS NULL OR p.created_at<$3)
       GROUP BY p.id, r.id
       ORDER BY p.created_at DESC,p.id DESC LIMIT $4`,
      [schoolId, authorMembershipId, before ?? null, Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }

  async findPost(schoolId: string, postId: string, guardianUserId?: string, studentId?: string) {
    const params: unknown[] = [schoolId, postId, guardianUserId ?? null, studentId ?? null];
    let authorization = '';
    if (guardianUserId && studentId) {
      authorization = `AND p.status IN ('PUBLISHED','UPDATED') AND EXISTS (SELECT 1 FROM post_recipients pr WHERE pr.post_id=p.id AND pr.guardian_user_id=$3 AND pr.student_id=$4)`;
    }
    const result = await this.pool.query(
      `SELECT p.id, p.school_id AS "schoolId", p.author_membership_id AS "authorMembershipId", p.class_id AS "classId", p.post_type AS "postType", p.status,
              p.published_at AS "publishedAt",p.scheduled_for AS "scheduledFor", r.id AS "revisionId", r.revision_number AS "revisionNumber",
              r.title, r.body, r.subject_code AS "subjectCode", r.exam_name AS "examName", r.due_date AS "dueDate", r.urgent,r.audience_type AS "audienceType",
              COALESCE((SELECT json_agg(json_build_object('fileId',a.file_id,'studentId',a.student_id,'privacyClassification',a.privacy_classification) ORDER BY a.display_order)
                FROM post_attachments a WHERE a.post_revision_id=r.id AND ($3::uuid IS NULL OR $4::uuid IS NULL OR a.student_id IS NULL OR a.student_id=$4)), '[]') AS attachments
       FROM posts p JOIN post_revisions r ON r.post_id=p.id AND r.revision_number=p.current_revision_number
       WHERE p.school_id=$1 AND p.id=$2 ${authorization}`, params);
    if (!result.rowCount) throw new NotFoundException({ code: 'POST_NOT_FOUND_OR_NOT_AUTHORIZED' });
    return result.rows[0];
  }

  async fileContext(schoolId: string, fileId: string) {
    const result = await this.pool.query(
      `SELECT p.id AS "postId",p.school_id AS "schoolId",p.author_membership_id AS "authorMembershipId",p.class_id AS "classId",
              a.student_id AS "studentId",a.privacy_classification AS "privacyClassification"
       FROM post_attachments a JOIN post_revisions r ON r.id=a.post_revision_id JOIN posts p ON p.id=r.post_id
       WHERE p.school_id=$1 AND a.file_id=$2 AND p.status IN ('PUBLISHED','UPDATED')
       ORDER BY r.revision_number DESC LIMIT 1`, [schoolId, fileId]);
    if (!result.rowCount) throw new NotFoundException({ code: 'FILE_ATTACHMENT_NOT_FOUND' });
    return result.rows[0];
  }

  async create(input: CreatePostRequest) {
    if (!input.title?.trim() || !input.body?.trim() || !input.recipients?.length) throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    if (input.postType === 'HOMEWORK' && !input.dueDate) throw new BadRequestException({ code: 'DUE_DATE_REQUIRED' });
    if (input.postType === 'RESULT') {
      if (!input.examName || !input.attachments?.length || input.attachments.some((item) => item.privacyClassification === 'STUDENT_PRIVATE' && !item.studentId)) {
        throw new BadRequestException({ code: 'RESULT_PRIVACY_MAPPING_REQUIRED' });
      }
    }
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    if (input.scheduledFor && (input.postType !== 'ANNOUNCEMENT' || !scheduledFor || Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now() || scheduledFor.getTime() > Date.now() + 366 * 86_400_000)) {
      throw new BadRequestException({ code: 'SCHEDULE_INVALID' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const hash = requestHash({ ...input, correlationId: undefined });
      const existing = await client.query<{ request_hash: string; response_body: unknown }>(
        `SELECT request_hash, response_body FROM idempotency_keys WHERE actor_id=$1 AND operation='CREATE_POST' AND idempotency_key=$2 AND expires_at>now() FOR UPDATE`,
        [input.actorUserId, input.idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0]!.request_hash !== hash) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REUSED' });
        await client.query('COMMIT');
        return existing.rows[0]!.response_body;
      }

      const postId = randomUUID();
      const revisionId = randomUUID();
      await client.query(
        `INSERT INTO posts (id, school_id, author_membership_id, class_id, post_type, status, published_at,scheduled_for,created_correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::timestamptz IS NULL THEN now() ELSE NULL END,$7,$8)`,
        [postId, input.schoolId, input.authorMembershipId, input.classId ?? null, input.postType, scheduledFor ? 'SCHEDULED' : 'PUBLISHED', scheduledFor, input.correlationId ?? null]);
      await client.query(
        `INSERT INTO post_revisions (id, post_id, revision_number, title, body, subject_code, exam_name, due_date, audience_type, urgent, created_by_membership_id)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [revisionId, postId, input.title.trim(), input.body.trim(), input.subjectCode ?? null, input.examName ?? null, input.dueDate ?? null, input.audienceType, input.urgent ?? false, input.authorMembershipId]);
      for (const recipient of input.recipients) {
        await client.query(
          `INSERT INTO post_recipients (post_id, school_id, student_id, guardian_user_id, recipient_snapshot) VALUES ($1,$2,$3,$4,$5)`,
          [postId, input.schoolId, recipient.studentId, recipient.guardianUserId, recipient.snapshot ?? {}]);
      }
      for (const attachment of input.attachments ?? []) {
        await client.query(
          `INSERT INTO post_attachments (post_revision_id, file_id, student_id, privacy_classification) VALUES ($1,$2,$3,$4)`,
          [revisionId, attachment.fileId, attachment.studentId ?? null, attachment.privacyClassification]);
      }
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload) VALUES ($1,$2,$3,$4)`,
        [eventId, scheduledFor ? domainEventTypes.postScheduled : domainEventTypes.postPublished, postId, { schoolId: input.schoolId, postId, postType: input.postType, correlationId: input.correlationId,
          recipients: input.recipients, notification: { title: input.title.trim(), body: input.body.trim().slice(0, 500) },
          post: { id: postId, schoolId: input.schoolId, authorMembershipId: input.authorMembershipId, classId: input.classId ?? null,
            postType: input.postType, status: scheduledFor ? 'SCHEDULED' : 'PUBLISHED', publishedAt: scheduledFor ? null : new Date().toISOString(),
            scheduledFor: scheduledFor?.toISOString() ?? null, revisionNumber: 1, title: input.title.trim(), body: input.body.trim(),
            subjectCode: input.subjectCode ?? null, examName: input.examName ?? null, dueDate: input.dueDate ?? null,
            urgent: input.urgent ?? false, attachments: input.attachments ?? [] } }]);
      if (scheduledFor) await client.query(`SELECT pg_notify('schoolconnect_post_schedule',$1)`, [postId]);
      const response = { id: postId, revisionId, status: scheduledFor ? 'SCHEDULED' : 'PUBLISHED', recipientCount: input.recipients.length, eventId, scheduledFor };
      await client.query(
        `INSERT INTO idempotency_keys (actor_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at)
         VALUES ($1,'CREATE_POST',$2,$3,201,$4,now()+interval '7 days')`,
        [input.actorUserId, input.idempotencyKey, hash, response]);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async saveDraft(input: { schoolId: string; authorMembershipId: string; classId: string; postType: CreatePostRequest['postType']; payload: Record<string, unknown> }) {
    if (!input.classId || !['HOMEWORK', 'RESULT', 'ANNOUNCEMENT'].includes(input.postType) || JSON.stringify(input.payload).length > 100_000) throw new BadRequestException({ code: 'DRAFT_VALIDATION_FAILED' });
    const result = await this.pool.query(
      `INSERT INTO post_drafts (school_id,author_membership_id,class_id,post_type,payload) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (school_id,author_membership_id,class_id,post_type) DO UPDATE SET payload=excluded.payload,version=post_drafts.version+1,updated_at=now()
       RETURNING id,version,updated_at AS "updatedAt"`, [input.schoolId, input.authorMembershipId, input.classId, input.postType, input.payload]);
    return result.rows[0];
  }
  async drafts(schoolId: string, authorMembershipId: string) {
    const result = await this.pool.query(`SELECT id,class_id AS "classId",post_type AS "postType",payload,version,updated_at AS "updatedAt" FROM post_drafts WHERE school_id=$1 AND author_membership_id=$2 ORDER BY updated_at DESC LIMIT 50`, [schoolId, authorMembershipId]);
    return result.rows;
  }
  async deleteDraft(schoolId: string, authorMembershipId: string, draftId: string) {
    await this.pool.query(`DELETE FROM post_drafts WHERE id=$1 AND school_id=$2 AND author_membership_id=$3`, [draftId, schoolId, authorMembershipId]);
    return { deleted: true };
  }

  async createRevision(postId: string, input: CreatePostRevisionRequest) {
    if (!input.title?.trim() || !input.body?.trim() || !Number.isInteger(input.expectedRevisionNumber)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        post_type: CreatePostRequest['postType']; status: string; current_revision_number: number; class_id: string | null; published_at: Date | null;
        author_membership_id: string; subject_code: string | null; exam_name: string | null;
        due_date: string | null; audience_type: CreatePostRequest['audienceType']; urgent: boolean; revision_id: string; scheduled_for: Date | null;
      }>(
        `SELECT p.post_type, p.status, p.current_revision_number, p.author_membership_id, p.class_id, p.published_at,
                r.subject_code, r.exam_name, r.due_date::text, r.audience_type, r.urgent, r.id AS revision_id,p.scheduled_for
         FROM posts p
         JOIN post_revisions r ON r.post_id=p.id AND r.revision_number=p.current_revision_number
         WHERE p.school_id=$1 AND p.id=$2
         FOR UPDATE OF p`,
        [input.schoolId, postId]);
      if (!current.rowCount) throw new NotFoundException({ code: 'POST_NOT_FOUND' });
      const post = current.rows[0]!;
      if (post.author_membership_id !== input.authorMembershipId) throw new ForbiddenException({ code: 'POST_EDIT_NOT_AUTHORIZED' });
      if (!['PUBLISHED', 'UPDATED','SCHEDULED'].includes(post.status)) throw new BadRequestException({ code: 'POST_NOT_EDITABLE' });
      if (post.current_revision_number !== input.expectedRevisionNumber) {
        throw new ConflictException({ code: 'POST_REVISION_CONFLICT', currentRevisionNumber: post.current_revision_number });
      }

      const dueDate = input.dueDate ?? post.due_date ?? undefined;
      const examName = input.examName ?? post.exam_name ?? undefined;
      if (post.post_type === 'HOMEWORK' && !dueDate) throw new BadRequestException({ code: 'DUE_DATE_REQUIRED' });
      if (post.post_type === 'RESULT' && !examName) throw new BadRequestException({ code: 'EXAM_NAME_REQUIRED' });
      if (input.scheduledFor && post.status !== 'SCHEDULED') throw new BadRequestException({ code: 'PUBLISHED_POST_CANNOT_BE_RESCHEDULED' });
      const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : post.scheduled_for;
      if (post.status === 'SCHEDULED' && (!scheduledFor || !Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now())) throw new BadRequestException({ code: 'SCHEDULE_TIME_INVALID' });
      const nextStatus = post.status === 'SCHEDULED' ? 'SCHEDULED' : 'UPDATED';

      const nextRevisionNumber = post.current_revision_number + 1;
      const revisionId = randomUUID();
      await client.query(
        `INSERT INTO post_revisions
           (id, post_id, revision_number, title, body, subject_code, exam_name, due_date, audience_type, urgent, change_kind, created_by_membership_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [revisionId, postId, nextRevisionNumber, input.title.trim(), input.body.trim(), input.subjectCode ?? post.subject_code,
          examName ?? null, dueDate ?? null, post.audience_type, input.urgent ?? post.urgent,
          input.changeKind ?? 'MATERIAL', input.authorMembershipId]);
      await client.query(
        `INSERT INTO post_attachments (post_revision_id, file_id, student_id, privacy_classification, display_order)
         SELECT $1, file_id, student_id, privacy_classification, display_order
         FROM post_attachments WHERE post_revision_id=$2`,
        [revisionId, post.revision_id]);
      await client.query(
        `UPDATE posts SET current_revision_number=$1, status=$3,scheduled_for=$4, updated_at=now() WHERE id=$2`,
        [nextRevisionNumber, postId,nextStatus,scheduledFor]);
      const recipients = await client.query<{ student_id: string; guardian_user_id: string }>(
        `SELECT student_id, guardian_user_id FROM post_recipients WHERE post_id=$1`,
        [postId]);
      const attachments = await client.query<{ file_id: string; student_id: string | null; privacy_classification: string }>(
        `SELECT file_id,student_id,privacy_classification FROM post_attachments WHERE post_revision_id=$1 ORDER BY display_order`, [revisionId]);
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1,$4,$2,$3)`,
        [eventId, postId, {
          schoolId: input.schoolId,
          postId,
          revisionNumber: nextRevisionNumber,
          actorUserId: input.actorUserId,
          correlationId: input.correlationId,
          material: (input.changeKind ?? 'MATERIAL') === 'MATERIAL',
          notification: { title: input.title.trim(), body: input.body.trim().slice(0, 500) },
          recipients: recipients.rows.map((recipient) => ({ studentId: recipient.student_id, guardianUserId: recipient.guardian_user_id })),
          post: { id: postId, schoolId: input.schoolId, authorMembershipId: input.authorMembershipId, classId: post.class_id,
            postType: post.post_type, status: nextStatus, publishedAt: post.published_at, scheduledFor,
            revisionNumber: nextRevisionNumber, title: input.title.trim(), body: input.body.trim(),
            subjectCode: input.subjectCode ?? post.subject_code, examName: examName ?? null, dueDate: dueDate ?? null,
            urgent: input.urgent ?? post.urgent, attachments: attachments.rows.map((item) => ({ fileId: item.file_id, studentId: item.student_id, privacyClassification: item.privacy_classification })) },
        }, nextStatus === 'SCHEDULED' ? domainEventTypes.scheduledPostUpdated : domainEventTypes.postUpdated]);
      if (nextStatus === 'SCHEDULED') await client.query(`SELECT pg_notify('schoolconnect_post_schedule',$1)`, [postId]);
      await client.query('COMMIT');
      return { id: postId, revisionId, revisionNumber: nextRevisionNumber, status: nextStatus, eventId,scheduledFor };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async recordView(schoolId: string, postId: string, guardianUserId: string, studentId: string) {
    await this.findPost(schoolId, postId, guardianUserId, studentId);
    const result = await this.pool.query(
      `INSERT INTO post_views (post_id, guardian_user_id, student_id) VALUES ($1,$2,$3)
       ON CONFLICT (post_id, guardian_user_id, student_id) DO UPDATE SET last_viewed_at=now(), view_count=post_views.view_count+1
       RETURNING first_viewed_at AS "firstViewedAt", last_viewed_at AS "lastViewedAt", view_count AS "viewCount"`,
      [postId, guardianUserId, studentId]);
    return result.rows[0];
  }

  async archive(schoolId: string, postId: string, authorMembershipId: string, expectedRevisionNumber: number, actorUserId?: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ id: string; status: string; current_revision_number: number; archivedAt: Date }>(`SELECT id,status,current_revision_number,archived_at AS "archivedAt" FROM posts
        WHERE id=$1 AND school_id=$2 AND author_membership_id=$3 FOR UPDATE`, [postId,schoolId,authorMembershipId]);
      const post = current.rows[0];
      if (!post || post.current_revision_number !== expectedRevisionNumber || !['PUBLISHED','UPDATED','SCHEDULED','ARCHIVED'].includes(post.status)) throw new ConflictException({ code: 'POST_ARCHIVE_CONFLICT_OR_NOT_AUTHORIZED' });
      if (post.status === 'ARCHIVED') { await client.query('COMMIT'); return { id: post.id,status: post.status,archivedAt: post.archivedAt }; }
      const result = await client.query(`UPDATE posts SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE id=$1 RETURNING id,status,archived_at AS "archivedAt"`, [postId]);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.postArchived,postId,{ schoolId,postId,actorUserId,actorMembershipId: authorMembershipId,correlationId }]);
      if (post.status === 'SCHEDULED') await client.query(`SELECT pg_notify('schoolconnect_post_schedule',$1)`, [postId]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async report(schoolId: string, postId: string) {
    const result = await this.pool.query(`SELECT p.id,p.author_membership_id AS "authorMembershipId",p.status,p.post_type AS "postType",p.published_at AS "publishedAt",
      COUNT(DISTINCT (pr.guardian_user_id,pr.student_id))::int AS "recipientCount",
      COUNT(DISTINCT (v.guardian_user_id,v.student_id)) FILTER (WHERE v.guardian_user_id IS NOT NULL)::int AS "viewedCount",
      COALESCE(SUM(v.view_count),0)::int AS "totalViews"
      FROM posts p LEFT JOIN post_recipients pr ON pr.post_id=p.id
      LEFT JOIN post_views v ON v.post_id=p.id AND v.guardian_user_id=pr.guardian_user_id AND v.student_id=pr.student_id
      WHERE p.school_id=$1 AND p.id=$2 GROUP BY p.id`, [schoolId, postId]);
    if (!result.rowCount) throw new NotFoundException({ code: 'POST_NOT_FOUND' });
    return result.rows[0];
  }

  async publishDue(limit = 25) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<{ id: string; school_id: string; post_type: string; created_correlation_id: string | null; title: string; body: string;
        author_membership_id: string; class_id: string | null; revision_number: number; subject_code: string | null; exam_name: string | null;
        due_date: string | null; urgent: boolean; revision_id: string }>(`SELECT p.id,p.school_id,p.post_type,p.created_correlation_id,r.title,r.body,
          p.author_membership_id,p.class_id,r.revision_number,r.subject_code,r.exam_name,r.due_date::text,r.urgent,r.id AS revision_id
        FROM posts p JOIN post_revisions r ON r.post_id=p.id AND r.revision_number=p.current_revision_number
        WHERE p.status='SCHEDULED' AND p.scheduled_for<=now() ORDER BY p.scheduled_for FOR UPDATE OF p SKIP LOCKED LIMIT $1`, [Math.min(Math.max(limit,1),100)]);
      for (const post of due.rows) {
        await client.query(`UPDATE posts SET status='PUBLISHED',published_at=now(),updated_at=now() WHERE id=$1`, [post.id]);
        const recipients = await client.query<{ student_id: string; guardian_user_id: string }>(`SELECT student_id,guardian_user_id FROM post_recipients WHERE post_id=$1`, [post.id]);
        const attachments = await client.query<{ file_id: string; student_id: string | null; privacy_classification: string }>(
          `SELECT file_id,student_id,privacy_classification FROM post_attachments WHERE post_revision_id=$1 ORDER BY display_order`, [post.revision_id]);
        await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
          [domainEventTypes.postPublished, post.id, { schoolId: post.school_id, postId: post.id, postType: post.post_type, correlationId: post.created_correlation_id,
            recipients: recipients.rows.map((row) => ({ studentId: row.student_id, guardianUserId: row.guardian_user_id })),
            notification: { title: post.title, body: post.body.slice(0, 500) },
            post: { id: post.id, schoolId: post.school_id, authorMembershipId: post.author_membership_id, classId: post.class_id,
              postType: post.post_type, status: 'PUBLISHED', publishedAt: new Date().toISOString(), scheduledFor: null,
              revisionNumber: post.revision_number, title: post.title, body: post.body, subjectCode: post.subject_code,
              examName: post.exam_name, dueDate: post.due_date, urgent: post.urgent,
              attachments: attachments.rows.map((item) => ({ fileId: item.file_id, studentId: item.student_id, privacyClassification: item.privacy_classification })) } }]);
      }
      await client.query('COMMIT');
      return { published: due.rows.length };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
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
class ContentController {
  constructor(@Inject(ContentRepository) private readonly repository: ContentRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'content', database: await this.repository.health() }; }
  @Get('timeline') timeline(@Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId: string, @Query('studentId') studentId: string, @Query('before') before?: string, @Query('limit') limit = '50') { return this.repository.timeline(schoolId, guardianUserId, studentId, before, Number(limit)); }
  @Get('teacher-posts') teacherPosts(@Query('schoolId') schoolId: string, @Query('authorMembershipId') authorMembershipId: string, @Query('before') before?: string, @Query('limit') limit = '50') { return this.repository.teacherPosts(schoolId, authorMembershipId, before, Number(limit)); }
  @Get('posts/:postId') post(@Param('postId') postId: string, @Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId?: string, @Query('studentId') studentId?: string) { return this.repository.findPost(schoolId, postId, guardianUserId, studentId); }
  @Get('files/:fileId/context') fileContext(@Param('fileId') fileId: string, @Query('schoolId') schoolId: string) { return this.repository.fileContext(schoolId, fileId); }
  @Post('posts') create(@Body() body: CreatePostRequest) { return this.repository.create(body); }
  @Post('drafts') saveDraft(@Body() body: Parameters<ContentRepository['saveDraft']>[0]) { return this.repository.saveDraft(body); }
  @Get('drafts') drafts(@Query('schoolId') schoolId: string, @Query('authorMembershipId') authorMembershipId: string) { return this.repository.drafts(schoolId, authorMembershipId); }
  @Post('drafts/:draftId/delete') deleteDraft(@Param('draftId') draftId: string, @Body() body: { schoolId: string; authorMembershipId: string }) { return this.repository.deleteDraft(body.schoolId, body.authorMembershipId, draftId); }
  @Post('posts/:postId/revisions') createRevision(@Param('postId') postId: string, @Body() body: CreatePostRevisionRequest) { return this.repository.createRevision(postId, body); }
  @Post('posts/:postId/views') view(@Param('postId') postId: string, @Body() body: { schoolId: string; guardianUserId: string; studentId: string }) { return this.repository.recordView(body.schoolId, postId, body.guardianUserId, body.studentId); }
  @Post('posts/:postId/archive') archive(@Param('postId') postId: string, @Body() body: { schoolId: string; authorMembershipId: string; expectedRevisionNumber: number; actorUserId?: string; correlationId?: string }) { return this.repository.archive(body.schoolId, postId, body.authorMembershipId, body.expectedRevisionNumber,body.actorUserId,body.correlationId); }
  @Get('posts/:postId/report') report(@Param('postId') postId: string, @Query('schoolId') schoolId: string) { return this.repository.report(schoolId, postId); }
  @Post('scheduled/publish-due') publishDue(@Body() body: { limit?: number }) { return this.repository.publishDue(body.limit); }
  @Get('outbox') outbox(@Query('limit') limit = '25') { return this.repository.claimOutbox(Number(limit)); }
  @Post('outbox/:eventId/complete') completeOutbox(@Param('eventId') eventId: string, @Body() body: { success?: boolean }) { return this.repository.completeOutbox(eventId, body.success !== false); }
}

@Module({ controllers: [ContentController], providers: [ContentRepository,
  { provide: ScheduledPostRunner, useFactory: (repository: ContentRepository) => new ScheduledPostRunner(repository,
    process.env.CONTENT_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_content'), inject: [ContentRepository] },
] })
class ContentModule {}
async function bootstrap() { const app = await NestFactory.create(ContentModule); app.enableShutdownHooks(); const token=process.env.INTERNAL_SERVICE_TOKEN; if (process.env.NODE_ENV==='production' && (!token || token.length<32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED'); if(token) app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'})); await app.listen(Number(process.env.CONTENT_PORT ?? 3103), process.env.SERVICE_BIND_HOST ?? '127.0.0.1'); await startOutboxPublisher('content', app.get(ContentRepository)); }
void bootstrap();
