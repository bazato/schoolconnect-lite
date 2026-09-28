import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createMalwareScanner, MalwareScanner, PrivateObjectStorage, S3PrivateObjectStorage } from './storage';

@Injectable()
class FileRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.FILE_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_files', max: Number(process.env.FILES_DB_POOL_MAX ?? 6), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }
  constructor(private readonly storage: PrivateObjectStorage, private readonly scanner: MalwareScanner) {}
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
      const url = await this.storage.createUploadUrl(quarantineKey, input.mediaType, input.byteSize, input.checksumSha256.toLowerCase());
      return { fileId, uploadSessionId, status: 'QUARANTINED', upload: { mode: 'S3_PRESIGNED_PUT', url, objectKey: quarantineKey, expiresInSeconds: Number(process.env.FILE_URL_TTL_SECONDS ?? 300), requiredHeaders: { 'content-type': input.mediaType, 'x-amz-meta-checksumsha256': input.checksumSha256.toLowerCase() } } };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async completeUpload(uploadSessionId: string, actorUserId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ file_id: string; quarantine_object_key: string; byte_size: string }>(`UPDATE upload_sessions s SET status='UPLOADED', completed_at=now() FROM file_objects f WHERE s.id=$1 AND s.file_id=f.id AND f.uploaded_by_user_id=$2 AND s.status IN ('CREATED','UPLOADING') AND s.expires_at>now() RETURNING s.file_id,f.quarantine_object_key,f.byte_size`, [uploadSessionId, actorUserId]);
      if (!session.rowCount) throw new NotFoundException({ code: 'UPLOAD_SESSION_NOT_FOUND_OR_EXPIRED' });
      await this.storage.verifyUpload(session.rows[0]!.quarantine_object_key, Number(session.rows[0]!.byte_size));
      await client.query(`UPDATE file_objects SET processing_status='SCANNING' WHERE id=$1`, [session.rows[0]!.file_id]);
      await client.query(`INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('files.upload-completed.v1',$1,$2)`, [session.rows[0]!.file_id, { fileId: session.rows[0]!.file_id }]);
      await client.query('COMMIT');
      const fileId = session.rows[0]!.file_id;
      const privateKey = `${fileId.slice(0, 2)}/${fileId}`;
      try {
        await this.scanner.assertClean(session.rows[0]!.quarantine_object_key);
        await this.storage.promote(session.rows[0]!.quarantine_object_key, privateKey);
        await this.pool.query(`UPDATE file_objects SET processing_status='READY',private_object_key=$1,ready_at=now() WHERE id=$2`, [privateKey, fileId]);
        return { fileId, status: 'READY' };
      } catch (error) {
        await this.pool.query(`UPDATE file_objects SET processing_status='REJECTED',rejection_code=$1 WHERE id=$2`, [error instanceof Error ? error.message.slice(0, 80) : 'SCAN_FAILED', fileId]);
        throw new BadRequestException({ code: 'FILE_REJECTED_OR_SCAN_FAILED' });
      }
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
    return { mode: 'S3_PRESIGNED_GET', url: await this.storage.createDownloadUrl(file.rows[0]!.private_object_key!), expiresInSeconds: Number(process.env.FILE_URL_TTL_SECONDS ?? 60), cacheControl: 'private, no-store' };
  }
  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class FileController {
  constructor(@Inject(FileRepository) private readonly repository: FileRepository) {}
  @Get('health') async health() { return { status: 'ok', service: 'files', database: await this.repository.health() }; }
  @Post('uploads') upload(@Body() body: Parameters<FileRepository['createUpload']>[0]) { return this.repository.createUpload(body); }
  @Post('uploads/:uploadSessionId/complete') complete(@Param('uploadSessionId') id: string, @Body() body: { actorUserId: string }) { return this.repository.completeUpload(id, body.actorUserId); }
  @Post('files/:fileId/access') access(@Param('fileId') fileId: string, @Body() body: Parameters<FileRepository['access']>[1]) { return this.repository.access(fileId, body); }
}
@Module({ controllers: [FileController], providers: [
  { provide: 'PRIVATE_OBJECT_STORAGE', useFactory: () => new S3PrivateObjectStorage() },
  { provide: 'MALWARE_SCANNER', useFactory: () => createMalwareScanner() },
  { provide: FileRepository, useFactory: (storage: PrivateObjectStorage, scanner: MalwareScanner) => new FileRepository(storage, scanner), inject: ['PRIVATE_OBJECT_STORAGE', 'MALWARE_SCANNER'] },
] }) class FileModule {}
async function bootstrap() { const app = await NestFactory.create(FileModule); const token=process.env.INTERNAL_SERVICE_TOKEN; if (process.env.NODE_ENV==='production' && (!token || token.length<32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED'); if(token) app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'})); await app.listen(Number(process.env.FILE_PORT ?? 3105), process.env.SERVICE_BIND_HOST ?? '127.0.0.1'); }
void bootstrap();
