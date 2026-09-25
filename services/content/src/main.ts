import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

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
  idempotencyKey: string;
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
  changeKind?: 'MATERIAL' | 'MINOR';
};

const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
class ContentRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.CONTENT_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_content' });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  async timeline(schoolId: string, guardianUserId: string, studentId: string) {
    const result = await this.pool.query(
      `SELECT p.id, p.post_type AS "postType", p.status, p.published_at AS "publishedAt",
              r.revision_number AS "revisionNumber", r.title, r.body, r.subject_code AS "subjectCode",
              r.exam_name AS "examName", r.due_date AS "dueDate", r.urgent,
              COALESCE(json_agg(json_build_object('fileId', a.file_id, 'studentId', a.student_id, 'privacyClassification', a.privacy_classification)) FILTER (WHERE a.id IS NOT NULL), '[]') AS attachments
       FROM post_recipients pr
       JOIN posts p ON p.id = pr.post_id
       JOIN post_revisions r ON r.post_id = p.id AND r.revision_number = p.current_revision_number
       LEFT JOIN post_attachments a ON a.post_revision_id = r.id AND (a.student_id IS NULL OR a.student_id = pr.student_id)
       WHERE pr.school_id = $1 AND pr.guardian_user_id = $2 AND pr.student_id = $3 AND p.status IN ('PUBLISHED','UPDATED')
       GROUP BY p.id, r.id ORDER BY p.published_at DESC`, [schoolId, guardianUserId, studentId]);
    return result.rows;
  }

  async teacherPosts(schoolId: string, authorMembershipId: string) {
    const result = await this.pool.query(
      `SELECT p.id, p.post_type AS "postType", p.status, p.published_at AS "publishedAt",
              r.revision_number AS "revisionNumber", r.title, r.body, r.subject_code AS "subjectCode",
              r.exam_name AS "examName", r.due_date AS "dueDate", r.urgent,
              COUNT(pr.student_id)::integer AS "recipientCount"
       FROM posts p
       JOIN post_revisions r ON r.post_id = p.id AND r.revision_number = p.current_revision_number
       LEFT JOIN post_recipients pr ON pr.post_id = p.id
       WHERE p.school_id = $1 AND p.author_membership_id = $2 AND p.status IN ('PUBLISHED','UPDATED')
       GROUP BY p.id, r.id
       ORDER BY p.published_at DESC`,
      [schoolId, authorMembershipId]);
    return result.rows;
  }

  async findPost(schoolId: string, postId: string, guardianUserId?: string, studentId?: string) {
    const params: unknown[] = [schoolId, postId];
    let authorization = '';
    if (guardianUserId && studentId) {
      params.push(guardianUserId, studentId);
      authorization = `AND EXISTS (SELECT 1 FROM post_recipients pr WHERE pr.post_id=p.id AND pr.guardian_user_id=$3 AND pr.student_id=$4)`;
    }
    const result = await this.pool.query(
      `SELECT p.id, p.school_id AS "schoolId", p.author_membership_id AS "authorMembershipId", p.class_id AS "classId", p.post_type AS "postType", p.status,
              p.published_at AS "publishedAt", r.id AS "revisionId", r.revision_number AS "revisionNumber",
              r.title, r.body, r.subject_code AS "subjectCode", r.exam_name AS "examName", r.due_date AS "dueDate", r.urgent
       FROM posts p JOIN post_revisions r ON r.post_id=p.id AND r.revision_number=p.current_revision_number
       WHERE p.school_id=$1 AND p.id=$2 ${authorization}`, params);
    if (!result.rowCount) throw new NotFoundException({ code: 'POST_NOT_FOUND_OR_NOT_AUTHORIZED' });
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const hash = requestHash(input);
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
        `INSERT INTO posts (id, school_id, author_membership_id, class_id, post_type, status, published_at)
         VALUES ($1,$2,$3,$4,$5,'PUBLISHED',now())`,
        [postId, input.schoolId, input.authorMembershipId, input.classId ?? null, input.postType]);
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
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload) VALUES ($1,'content.post-published.v1',$2,$3)`,
        [eventId, postId, { schoolId: input.schoolId, postId, postType: input.postType, recipients: input.recipients }]);
      const response = { id: postId, revisionId, status: 'PUBLISHED', recipientCount: input.recipients.length, eventId };
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

  async createRevision(postId: string, input: CreatePostRevisionRequest) {
    if (!input.title?.trim() || !input.body?.trim() || !Number.isInteger(input.expectedRevisionNumber)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        post_type: CreatePostRequest['postType']; status: string; current_revision_number: number;
        author_membership_id: string; subject_code: string | null; exam_name: string | null;
        due_date: string | null; audience_type: CreatePostRequest['audienceType']; urgent: boolean; revision_id: string;
      }>(
        `SELECT p.post_type, p.status, p.current_revision_number, p.author_membership_id,
                r.subject_code, r.exam_name, r.due_date::text, r.audience_type, r.urgent, r.id AS revision_id
         FROM posts p
         JOIN post_revisions r ON r.post_id=p.id AND r.revision_number=p.current_revision_number
         WHERE p.school_id=$1 AND p.id=$2
         FOR UPDATE OF p`,
        [input.schoolId, postId]);
      if (!current.rowCount) throw new NotFoundException({ code: 'POST_NOT_FOUND' });
      const post = current.rows[0]!;
      if (post.author_membership_id !== input.authorMembershipId) throw new ForbiddenException({ code: 'POST_EDIT_NOT_AUTHORIZED' });
      if (!['PUBLISHED', 'UPDATED'].includes(post.status)) throw new BadRequestException({ code: 'POST_NOT_EDITABLE' });
      if (post.current_revision_number !== input.expectedRevisionNumber) {
        throw new ConflictException({ code: 'POST_REVISION_CONFLICT', currentRevisionNumber: post.current_revision_number });
      }

      const dueDate = input.dueDate ?? post.due_date ?? undefined;
      const examName = input.examName ?? post.exam_name ?? undefined;
      if (post.post_type === 'HOMEWORK' && !dueDate) throw new BadRequestException({ code: 'DUE_DATE_REQUIRED' });
      if (post.post_type === 'RESULT' && !examName) throw new BadRequestException({ code: 'EXAM_NAME_REQUIRED' });

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
        `UPDATE posts SET current_revision_number=$1, status='UPDATED', updated_at=now() WHERE id=$2`,
        [nextRevisionNumber, postId]);
      const recipients = await client.query<{ student_id: string; guardian_user_id: string }>(
        `SELECT student_id, guardian_user_id FROM post_recipients WHERE post_id=$1`,
        [postId]);
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1,'content.post-updated.v1',$2,$3)`,
        [eventId, postId, {
          schoolId: input.schoolId,
          postId,
          revisionNumber: nextRevisionNumber,
          actorUserId: input.actorUserId,
          material: (input.changeKind ?? 'MATERIAL') === 'MATERIAL',
          recipients: recipients.rows.map((recipient) => ({ studentId: recipient.student_id, guardianUserId: recipient.guardian_user_id })),
        }]);
      await client.query('COMMIT');
      return { id: postId, revisionId, revisionNumber: nextRevisionNumber, status: 'UPDATED', eventId };
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

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class ContentController {
  constructor(@Inject(ContentRepository) private readonly repository: ContentRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'content', database: await this.repository.health() }; }
  @Get('timeline') timeline(@Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId: string, @Query('studentId') studentId: string) { return this.repository.timeline(schoolId, guardianUserId, studentId); }
  @Get('teacher-posts') teacherPosts(@Query('schoolId') schoolId: string, @Query('authorMembershipId') authorMembershipId: string) { return this.repository.teacherPosts(schoolId, authorMembershipId); }
  @Get('posts/:postId') post(@Param('postId') postId: string, @Query('schoolId') schoolId: string, @Query('guardianUserId') guardianUserId?: string, @Query('studentId') studentId?: string) { return this.repository.findPost(schoolId, postId, guardianUserId, studentId); }
  @Post('posts') create(@Body() body: CreatePostRequest) { return this.repository.create(body); }
  @Post('posts/:postId/revisions') createRevision(@Param('postId') postId: string, @Body() body: CreatePostRevisionRequest) { return this.repository.createRevision(postId, body); }
  @Post('posts/:postId/views') view(@Param('postId') postId: string, @Body() body: { schoolId: string; guardianUserId: string; studentId: string }) { return this.repository.recordView(body.schoolId, postId, body.guardianUserId, body.studentId); }
}

@Module({ controllers: [ContentController], providers: [ContentRepository] })
class ContentModule {}
async function bootstrap() { const app = await NestFactory.create(ContentModule); await app.listen(Number(process.env.CONTENT_PORT ?? 3103), '127.0.0.1'); }
void bootstrap();
