import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ServiceUnavailableException } from '@nestjs/common';
import { ClamdScanner, HttpClamAvScanner, type MalwareScanner } from './clamav';
import { CloudmersiveScanner } from './cloudmersive';
export type { MalwareScanner } from './clamav';

export interface PrivateObjectStorage {
  createUploadUrl(objectKey: string, mediaType: string, byteSize: number, checksumSha256: string): Promise<string>;
  createDownloadUrl(objectKey: string): Promise<string>;
  read(objectKey:string,maximum:number):Promise<Buffer>;
  putChecked(objectKey:string,bytes:Buffer,mediaType:string,checksum:string):Promise<void>;
  remove(objectKey:string):Promise<void>;
}

export class S3PrivateObjectStorage implements PrivateObjectStorage {
  private readonly bucket = process.env.S3_BUCKET ?? 'schoolconnect-private';
  private readonly client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  });
  async createUploadUrl(objectKey: string, mediaType: string, byteSize: number, checksumSha256: string) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: mediaType, ContentLength: byteSize, IfNoneMatch:'*', Metadata: { checksumsha256: checksumSha256 } }), { expiresIn: 300,signableHeaders:new Set(['content-length','if-none-match']) });
  }
  async createDownloadUrl(objectKey: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey, ResponseCacheControl: 'private, no-store',ResponseContentDisposition:'attachment' }), { expiresIn: 60 });
  }
  async read(objectKey:string,maximum:number) {
    const result=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:objectKey}),{abortSignal:AbortSignal.timeout(20000)});
    if(!result.Body)throw Error('OBJECT_NOT_FOUND');
    const chunks:Buffer[]=[];let total=0;
    try {for await(const chunk of result.Body as AsyncIterable<Uint8Array>){total+=chunk.length;if(total>maximum)throw Error('OBJECT_SIZE_LIMIT');chunks.push(Buffer.from(chunk));}}catch(error){(result.Body as {destroy?:()=>void}).destroy?.();throw error;}
    return Buffer.concat(chunks,total);
  }
  async putChecked(objectKey:string,bytes:Buffer,mediaType:string,checksum:string) {
    try {await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:objectKey,Body:bytes,ContentLength:bytes.length,ContentType:mediaType,CacheControl:'private, no-store',IfNoneMatch:'*',Metadata:{checksumsha256:checksum}}),{abortSignal:AbortSignal.timeout(20000)});}
    catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;
      const existing=await this.read(objectKey,bytes.length);if(!existing.equals(bytes))throw Error('IMMUTABLE_OBJECT_CONFLICT');}
  }
  async remove(objectKey:string){await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:objectKey}),{abortSignal:AbortSignal.timeout(20000)});}
}

export class DisabledPrivateObjectStorage implements PrivateObjectStorage {
  private disabled(): never { throw new ServiceUnavailableException({ code: 'FILE_ATTACHMENTS_DISABLED' }); }
  async createUploadUrl(): Promise<string> { return this.disabled(); }
  async createDownloadUrl(): Promise<string> { return this.disabled(); }
  async read():Promise<Buffer>{return this.disabled();}
  async putChecked():Promise<void>{this.disabled();}
  async remove():Promise<void>{this.disabled();}
}
export class DisabledScanner implements MalwareScanner {
  async assertClean(): Promise<string> { throw new ServiceUnavailableException({ code: 'FILE_ATTACHMENTS_DISABLED' }); }
  async health():Promise<string>{throw new ServiceUnavailableException({code:'FILE_ATTACHMENTS_DISABLED'});}
}
export const createPrivateObjectStorage = (): PrivateObjectStorage => {
  if (process.env.FILE_STORAGE_PROVIDER === 'disabled') return new DisabledPrivateObjectStorage();
  if (process.env.NODE_ENV === 'production' && process.env.FILE_STORAGE_PROVIDER !== 's3') throw new Error('FILE_STORAGE_PROVIDER_REQUIRED');
  return new S3PrivateObjectStorage();
};
export class DevelopmentCleanScanner implements MalwareScanner {
  async assertClean() {
    if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
    return 'development-only';
  }
  async health(){if(process.env.NODE_ENV==='production')throw Error('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');return 'development-only';}
}

export const createMalwareScanner = (): MalwareScanner => {
  if (process.env.FILE_STORAGE_PROVIDER === 'disabled') return new DisabledScanner();
  const provider = process.env.FILE_SCANNER_PROVIDER ?? 'development-clean';
  if (process.env.NODE_ENV === 'production' && provider === 'development-clean') throw new Error('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  if (provider === 'development-clean') return new DevelopmentCleanScanner();
  if(provider==='clamd')return new ClamdScanner();
  if(provider==='clamav-http')return new HttpClamAvScanner();
  if(provider==='cloudmersive')return new CloudmersiveScanner();
  throw new Error(`FILE_SCANNER_PROVIDER_UNAVAILABLE:${provider}`);
};
