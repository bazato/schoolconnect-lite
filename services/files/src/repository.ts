import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { PgOutbox, eventingStatus } from '@schoolconnect/eventing';
import { type MalwareScanner, type PrivateObjectStorage } from './storage';
import { FileValidationError } from './clamav';
import { fileCapabilities, fileUploadPolicy } from './file-policy';
import { validateFileBytes } from './validation';
import { compressForStorage } from './compression';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function storageBudgets() {
  const global=Number(process.env.FILE_STORAGE_BUDGET_BYTES ?? 8_000_000_000);
  const school=Number(process.env.FILE_SCHOOL_BUDGET_BYTES ?? 2_000_000_000);
  if(!Number.isSafeInteger(global)||!Number.isSafeInteger(school)||global<1||school<1||school>global)throw Error('FILE_STORAGE_BUDGET_INVALID');
  return {global,school};
}
type UploadInput={schoolId:string;ownerType:'POST'|'LEAVE_REQUEST';ownerId:string;actorUserId:string;fileName:string;mediaType:string;byteSize:number;checksumSha256:string};
type FileRow={id:string;school_id:string;uploaded_by_user_id:string;quarantine_object_key:string;private_object_key:string|null;byte_size:string;stored_byte_size:string|null;stored_checksum_sha256:string|null;checksum_sha256:string;media_type:string;processing_status:string;verified_checksum_sha256:string|null;scanner_version:string|null;created_at:Date;processing_lease_until:Date|null;expires_at:Date;session_status:string;processing_attempts:number};

export class FileRepository {
  constructor(private readonly storage:PrivateObjectStorage,private readonly scanner:MalwareScanner,
    private readonly pool=new Pool({connectionString:process.env.FILE_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_files',max:Number(process.env.FILES_DB_POOL_MAX ?? 6),connectionTimeoutMillis:3000,statement_timeout:5000})) {storageBudgets();}
  async health(){const result=await this.pool.query('SELECT now() AS now');return result.rows[0];}
  async capabilities(){
    const result=fileCapabilities();
    if(!result.attachmentsEnabled)return result;
    try{await this.scanner.health();return result;}catch(error){return {...result,attachmentsEnabled:false,reason:error instanceof Error&&error.message==='FILE_SCANNER_QUOTA_EXCEEDED'?error.message:'FILE_SCANNER_UNAVAILABLE'};}
  }
  private enabled(){if(!fileCapabilities().attachmentsEnabled)throw new ServiceUnavailableException({code:'FILE_ATTACHMENTS_DISABLED'});}
  async createUpload(input:UploadInput){
    this.enabled();
    if(!input || ![input.schoolId,input.actorUserId,input.ownerId].every(id=>typeof id==='string'&&uuid.test(id)) || !['POST','LEAVE_REQUEST'].includes(input.ownerType) || typeof input.fileName!=='string' || !input.fileName.trim() || input.fileName.length>255 || [...input.fileName].some(char=>char.charCodeAt(0)<32) || !fileUploadPolicy.mediaTypes.includes(input.mediaType) || !Number.isSafeInteger(input.byteSize) || input.byteSize<=0 || input.byteSize>fileUploadPolicy.maxByteSize || typeof input.checksumSha256!=='string' || !/^[a-f0-9]{64}$/i.test(input.checksumSha256))throw new BadRequestException({code:'FILE_POLICY_REJECTED'});
    try{await this.scanner.health();}catch(error){throw new ServiceUnavailableException({code:error instanceof Error&&error.message==='FILE_SCANNER_QUOTA_EXCEEDED'?error.message:'FILE_SCANNER_UNAVAILABLE'});}
    const fileId=randomUUID(),uploadSessionId=randomUUID(),key=`${input.schoolId}/quarantine/${fileId}`,checksum=input.checksumSha256.toLowerCase();
    // Signing does not create an object; never return this URL before quota reservation commits.
    const url=await this.storage.createUploadUrl(key,input.mediaType,input.byteSize,checksum);
    const budgets=storageBudgets(),client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(5213408)');
      const totals=await client.query<{total:string;school:string}>(`SELECT coalesce(sum(storage_reserved_bytes),0)::text AS total,coalesce(sum(storage_reserved_bytes) FILTER(WHERE school_id=$1),0)::text AS school FROM file_objects WHERE storage_reserved_bytes>0`,[input.schoolId]);
      if(Number(totals.rows[0]!.total)+input.byteSize*2>budgets.global || Number(totals.rows[0]!.school)+input.byteSize*2>budgets.school)throw new ConflictException({code:'FILE_STORAGE_QUOTA_EXCEEDED'});
      await client.query(`INSERT INTO file_objects(id,school_id,owner_type,owner_id,uploaded_by_user_id,original_file_name,media_type,byte_size,checksum_sha256,quarantine_object_key,storage_reserved_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[fileId,input.schoolId,input.ownerType,input.ownerId,input.actorUserId,input.fileName.trim(),input.mediaType,input.byteSize,checksum,key,input.byteSize*2]);
      await client.query(`INSERT INTO upload_sessions(id,school_id,file_id,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')`,[uploadSessionId,input.schoolId,fileId]);
      await client.query('COMMIT');
      return {fileId,uploadSessionId,status:'QUARANTINED',upload:{mode:'S3_PRESIGNED_PUT',url,expiresInSeconds:300,requiredHeaders:{'content-type':input.mediaType,'if-none-match':'*','x-amz-meta-checksumsha256':checksum}}};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async completeUpload(sessionId:string,actorUserId:string,schoolId:string,correlationId?:string){
    this.enabled();
    if(![sessionId,actorUserId,schoolId].every(id=>uuid.test(id)))throw new BadRequestException({code:'FILE_POLICY_REJECTED'});
    const client=await this.pool.connect(),token=randomUUID();let file:FileRow;
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(5213409)');
      const found=await client.query<FileRow>(`SELECT f.*,s.expires_at,s.status AS session_status FROM file_objects f JOIN upload_sessions s ON s.file_id=f.id WHERE s.id=$1 AND s.school_id=$2 AND f.school_id=$2 AND f.uploaded_by_user_id=$3 FOR UPDATE OF f,s`,[sessionId,schoolId,actorUserId]);
      if(!found.rowCount)throw new NotFoundException({code:'UPLOAD_SESSION_NOT_FOUND_OR_EXPIRED'});
      file=found.rows[0]!;
      if(file.processing_status==='READY' && file.stored_checksum_sha256 && file.verified_checksum_sha256===file.stored_checksum_sha256 && file.scanner_version){await client.query('COMMIT');return {fileId:file.id,status:'READY',byteSize:Number(file.stored_byte_size),originalByteSize:Number(file.byte_size)};}
      if(['READY','REJECTED','DELETED'].includes(file.processing_status))throw new BadRequestException({code:'FILE_REJECTED'});
      if(file.processing_lease_until && file.processing_lease_until.getTime()>Date.now())throw new ConflictException({code:'FILE_PROCESSING_BUSY'});
      if((file.session_status!=='UPLOADED' && file.expires_at.getTime()<Date.now()) || file.created_at.getTime()<Date.now()-86400000 || file.processing_attempts>=10)throw new BadRequestException({code:'UPLOAD_SESSION_NOT_FOUND_OR_EXPIRED'});
      const active=await client.query<{count:string}>(`SELECT count(*)::text AS count FROM file_objects WHERE processing_status='SCANNING' AND processing_lease_until>now()`);
      if(Number(active.rows[0]!.count)>=1)throw new ConflictException({code:'FILE_PROCESSING_BUSY'});
      file.private_object_key=file.private_object_key??`${schoolId}/private/${file.id}/${file.checksum_sha256}/compressed-v1`;
      await client.query(`UPDATE file_objects SET processing_status='SCANNING',processing_token=$2,processing_lease_until=now()+interval '5 minutes',processing_attempts=processing_attempts+1,processing_error=NULL,private_object_key=$3 WHERE id=$1`,[file.id,token,file.private_object_key]);
      await client.query(`UPDATE upload_sessions SET status='UPLOADED',completed_at=coalesce(completed_at,now()) WHERE id=$1`,[sessionId]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    try{
      const bytes=await this.storage.read(file.quarantine_object_key,Number(file.byte_size));
      validateFileBytes(bytes,{byteSize:Number(file.byte_size),checksum:file.checksum_sha256,mediaType:file.media_type});
      const prepared=await compressForStorage(bytes,file.media_type);
      const storedChecksum=createHash('sha256').update(prepared.bytes).digest('hex');
      validateFileBytes(prepared.bytes,{byteSize:prepared.bytes.length,checksum:storedChecksum,mediaType:prepared.mediaType});
      const version=await this.scanner.assertClean(prepared.bytes);
      const lease=await this.pool.query(`SELECT 1 FROM file_objects WHERE id=$1 AND processing_token=$2 AND processing_status='SCANNING' AND processing_lease_until>now()`,[file.id,token]);
      if(!lease.rowCount)throw Error('PROCESSING_LEASE_LOST');
      // The client can never write this key. Do NOT re-read/copy quarantine after scanning.
      await this.storage.putChecked(file.private_object_key!,prepared.bytes,prepared.mediaType,storedChecksum);
      const transaction=await this.pool.connect();
      try{
        await transaction.query('BEGIN');
        const ready=await transaction.query(`UPDATE file_objects SET processing_status='READY',verified_checksum_sha256=$4,stored_checksum_sha256=$4,stored_byte_size=$5,compression_method=$6,scanner_version=$3,scanned_at=now(),ready_at=now(),processing_token=NULL,processing_lease_until=NULL,storage_reserved_bytes=byte_size+$5 WHERE id=$1 AND processing_token=$2 AND processing_status='SCANNING' AND processing_lease_until>now() RETURNING id`,[file.id,token,version.slice(0,200),storedChecksum,prepared.bytes.length,prepared.method]);
        if(!ready.rowCount)throw Error('PROCESSING_LEASE_LOST');
        await transaction.query(`INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES($1,$2,$3)`,[domainEventTypes.fileUploadCompleted,file.id,{fileId:file.id,schoolId,actorUserId,correlationId,status:'READY'}]);
        await transaction.query('COMMIT');
      }catch(error){await transaction.query('ROLLBACK');throw error;}finally{transaction.release();}
      return {fileId:file.id,status:'READY',byteSize:prepared.bytes.length,originalByteSize:bytes.length};
    }catch(error){
      const permanent=error instanceof FileValidationError || (error instanceof Error && error.message==='OBJECT_SIZE_LIMIT');
      await this.pool.query(`UPDATE file_objects SET processing_status=$3,processing_error=$4,rejection_code=$5,processing_token=NULL,processing_lease_until=NULL WHERE id=$1 AND processing_token=$2 AND processing_status='SCANNING'`,[file.id,token,permanent?'REJECTED':'QUARANTINED',permanent?'FILE_VALIDATION_FAILED':'FILE_PROCESSING_UNAVAILABLE',permanent?'FILE_VALIDATION_FAILED':null]);
      if(permanent){const code=error instanceof Error&&['FILE_TOO_LARGE','FILE_CANNOT_COMPRESS_TO_LIMIT','FILE_SIGNED_PDF_TOO_LARGE','FILE_COMPRESSION_FAILED','FILE_IMAGE_DIMENSIONS_EXCEEDED','FILE_PDF_TOO_MANY_PAGES'].includes(error.message)?error.message:'FILE_REJECTED';throw new BadRequestException({code});}
      throw new ServiceUnavailableException({code:error instanceof Error&&error.message==='FILE_SCANNER_QUOTA_EXCEEDED'?error.message:'FILE_PROCESSING_UNAVAILABLE'});
    }
  }
  async validateAttachments(input:{schoolId:string;actorUserId:string;fileIds:string[]}){
    if(!uuid.test(input.schoolId)||!uuid.test(input.actorUserId)||!Array.isArray(input.fileIds)||input.fileIds.length>10||input.fileIds.some(id=>typeof id!=='string'||!uuid.test(id)))throw new BadRequestException({code:'FILE_POLICY_REJECTED'});
    const unique=[...new Set(input.fileIds)];if(!unique.length)return {valid:true};
    const result=await this.pool.query(`SELECT id FROM file_objects WHERE id=ANY($1::uuid[]) AND school_id=$2 AND uploaded_by_user_id=$3 AND owner_type='POST' AND processing_status='READY' AND private_object_key IS NOT NULL AND scanned_at IS NOT NULL AND scanner_version IS NOT NULL AND verified_checksum_sha256=stored_checksum_sha256`,[unique,input.schoolId,input.actorUserId]);
    if(result.rowCount!==unique.length)throw new ForbiddenException({code:'FILE_NOT_READY_OR_NOT_OWNED'});return {valid:true};
  }
  async access(fileId:string,input:{schoolId:string;actorUserId:string;studentId?:string;authorized:boolean;reason?:string}){
    this.enabled();
    const result=await this.pool.query<FileRow>(`SELECT * FROM file_objects WHERE id=$1 AND school_id=$2`,[fileId,input.schoolId]);
    if(!result.rowCount)throw new NotFoundException({code:'FILE_NOT_FOUND'});const file=result.rows[0]!;
    const allowed=input.authorized===true && file.processing_status==='READY' && file.private_object_key && file.scanner_version && file.stored_checksum_sha256 && file.verified_checksum_sha256===file.stored_checksum_sha256;
    await this.pool.query(`INSERT INTO file_access_events(school_id,file_id,actor_user_id,student_id,access_mode,decision,decision_reason) VALUES($1,$2,$3,$4,'SIGNED_URL',$5,$6)`,[input.schoolId,fileId,input.actorUserId,input.studentId??null,allowed?'ALLOWED':'DENIED',allowed?null:'NOT_READY_OR_UNAUTHORIZED']);
    if(!allowed)throw new ForbiddenException({code:'FILE_NOT_READY_OR_UNAUTHORIZED'});
    return {mode:'S3_PRESIGNED_GET',url:await this.storage.createDownloadUrl(file.private_object_key!),expiresInSeconds:60,cacheControl:'private, no-store'};
  }
  // Runs in this service, not a separate worker. Expiry grace prevents a still-valid PUT URL recreating deleted objects.
  async cleanupExpired(){
    let cleaned=0;
    for(let index=0;index<10;index++){
      const token=randomUUID();
      // Atomic short claim; no database connection/transaction held during remote deletes.
      const rows=await this.pool.query<FileRow>(`UPDATE file_objects SET processing_token=$1,processing_lease_until=now()+interval '3 minutes' WHERE id=(SELECT f.id FROM file_objects f WHERE quarantine_purged_at IS NULL AND created_at<now()-interval '10 minutes' AND (processing_lease_until IS NULL OR processing_lease_until<now()-interval '1 minute') AND (processing_status IN ('READY','REJECTED','DELETED') OR created_at<now()-interval '24 hours' OR EXISTS(SELECT 1 FROM upload_sessions s WHERE s.file_id=f.id AND s.status IN ('CREATED','UPLOADING') AND s.expires_at<now()-interval '5 minutes')) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[token]);
      if(!rows.rowCount)break;const file=rows.rows[0]!;
      try{
        await this.storage.remove(file.quarantine_object_key);
        const ready=file.processing_status==='READY';
        if(!ready && file.private_object_key)await this.storage.remove(file.private_object_key);
        const updated=await this.pool.query(`UPDATE file_objects SET quarantine_purged_at=now(),storage_reserved_bytes=$2,processing_status=$3,processing_token=NULL,processing_lease_until=NULL WHERE id=$1 AND processing_token=$4`,[file.id,ready?Number(file.stored_byte_size??file.byte_size):0,ready?'READY':'DELETED',token]);
        if(updated.rowCount)cleaned++;
      }catch(error){await this.pool.query(`UPDATE file_objects SET processing_token=NULL,processing_lease_until=NULL,processing_error='CLEANUP_RETRY_REQUIRED' WHERE id=$1 AND processing_token=$2`,[file.id,token]);throw error;}
    }
    return {cleaned};
  }
  async claimOutbox(limit:number){return new PgOutbox(this.pool).claim(limit);}
  async renewOutbox(id:string,token:string){return new PgOutbox(this.pool).renew(id,token);}
  async completeOutbox(id:string,success:boolean,token?:string,errorCode?:string){return new PgOutbox(this.pool).complete(id,success,token,errorCode);}
  async eventingDiagnostics(){return {runtime:eventingStatus('publisher:files'),outbox:await new PgOutbox(this.pool).status()};}
  async onModuleDestroy(){await this.pool.end();await this.scanner.close?.();}
}
