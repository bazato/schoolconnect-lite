import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

@Injectable()
class FileRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.FILE_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_files' });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }
  async createUpload(input: { schoolId: string; ownerType: 'POST' | 'LEAVE_REQUEST'; ownerId: string; actorUserId: string; fileName: string; mediaType: string; byteSize: number; checksumSha256: string }) {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(input.mediaType) || input.byteSize <= 0 || input.byteSize > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/i.test(input.checksumSha256)) {
      throw new BadRequestException({ code: 'FILE_POLICY_REJECTED' });
    }
    const fileId = randomUUID(); const uploadSessionId = randomUUID();
    const quarantineKey = `${input.schoolId}/quarantine/${fileId}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO file_objects (id, school_id, owner_type, owner_id, uploaded_by_user_id, original_file_name, media_type, byte_size, checksum_sha256, quarantine_object_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [fileId, input.schoolId, input.ownerType, input.ownerId, input.actorUserId, input.fileName, input.mediaType, input.byteSize, input.checksumSha256.toLowerCase(), quarantineKey]);
      await client.query(`INSERT INTO upload_sessions (id, school_id, file_id, expires_at) VALUES ($1,$2,$3,now()+interval '5 minutes')`, [uploadSessionId, input.schoolId, fileId]);
      await client.query('COMMIT');
      return { fileId, uploadSessionId, status: 'QUARANTINED', upload: { mode: 'S3_PRESIGNED_PUT_PENDING_PROVIDER', objectKey: quarantineKey, expiresInSeconds: 300 } };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async completeUpload(uploadSessionId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ file_id: string }>(`UPDATE upload_sessions SET status='UPLOADED', completed_at=now() WHERE id=$1 AND status IN ('CREATED','UPLOADING') AND expires_at>now() RETURNING file_id`, [uploadSessionId]);
      if (!session.rowCount) throw new NotFoundException({ code: 'UPLOAD_SESSION_NOT_FOUND_OR_EXPIRED' });
      await client.query(`UPDATE file_objects SET processing_status='SCANNING' WHERE id=$1`, [session.rows[0]!.file_id]);
      await client.query(`INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('files.upload-completed.v1',$1,$2)`, [session.rows[0]!.file_id, { fileId: session.rows[0]!.file_id }]);
      await client.query('COMMIT'); return { fileId: session.rows[0]!.file_id, status: 'SCANNING' };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async access(fileId: string, input: { schoolId: string; actorUserId: string; studentId?: string; authorized: boolean; reason?: string }) {
    const file = await this.pool.query<{ private_object_key: string | null; processing_status: string }>(`SELECT private_object_key, processing_status FROM file_objects WHERE id=$1 AND school_id=$2`, [fileId, input.schoolId]);
    if (!file.rowCount) throw new NotFoundException({ code: 'FILE_NOT_FOUND' });
    const allowed = input.authorized && file.rows[0]!.processing_status === 'READY';
    await this.pool.query(
      `INSERT INTO file_access_events (school_id, file_id, actor_user_id, student_id, access_mode, decision, decision_reason) VALUES ($1,$2,$3,$4,'AUTHENTICATED_STREAM',$5,$6)`,
      [input.schoolId, fileId, input.actorUserId, input.studentId ?? null, allowed ? 'ALLOWED' : 'DENIED', allowed ? null : input.reason ?? 'NOT_READY_OR_UNAUTHORIZED']);
    if (!allowed) throw new BadRequestException({ code: 'FILE_NOT_READY_OR_UNAUTHORIZED' });
    return { mode: 'AUTHENTICATED_STREAM', path: `/api/v1/files/${fileId}/stream`, expiresInSeconds: 60, cacheControl: 'private, no-store' };
  }
  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class FileController {
  constructor(@Inject(FileRepository) private readonly repository: FileRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'files', database: await this.repository.health() }; }
  @Post('uploads') upload(@Body() body: Parameters<FileRepository['createUpload']>[0]) { return this.repository.createUpload(body); }
  @Post('uploads/:uploadSessionId/complete') complete(@Param('uploadSessionId') id: string) { return this.repository.completeUpload(id); }
  @Post('files/:fileId/access') access(@Param('fileId') fileId: string, @Body() body: Parameters<FileRepository['access']>[1]) { return this.repository.access(fileId, body); }
}
@Module({ controllers: [FileController], providers: [FileRepository] }) class FileModule {}
async function bootstrap() { const app = await NestFactory.create(FileModule); await app.listen(Number(process.env.FILE_PORT ?? 3105), '127.0.0.1'); }
void bootstrap();
