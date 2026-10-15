import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ServiceUnavailableException } from '@nestjs/common';

export interface PrivateObjectStorage {
  createUploadUrl(objectKey: string, mediaType: string, byteSize: number, checksumSha256: string): Promise<string>;
  verifyUpload(objectKey: string, expectedBytes: number): Promise<void>;
  promote(quarantineKey: string, privateKey: string): Promise<void>;
  createDownloadUrl(objectKey: string): Promise<string>;
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
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: mediaType, ContentLength: byteSize, Metadata: { checksumsha256: checksumSha256 } }), { expiresIn: Number(process.env.FILE_URL_TTL_SECONDS ?? 300) });
  }
  async verifyUpload(objectKey: string, expectedBytes: number) {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (result.ContentLength !== expectedBytes) throw new Error('OBJECT_SIZE_MISMATCH');
  }
  async promote(quarantineKey: string, privateKey: string) {
    await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: privateKey, CopySource: `${this.bucket}/${encodeURIComponent(quarantineKey).replace(/%2F/g, '/')}`, MetadataDirective: 'COPY' }));
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: quarantineKey }));
  }
  async createDownloadUrl(objectKey: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey, ResponseCacheControl: 'private, no-store' }), { expiresIn: Number(process.env.FILE_URL_TTL_SECONDS ?? 60) });
  }
}

export interface MalwareScanner { assertClean(objectKey: string): Promise<void> }
export class DisabledPrivateObjectStorage implements PrivateObjectStorage {
  private disabled(): never { throw new ServiceUnavailableException({ code: 'FILE_ATTACHMENTS_DISABLED' }); }
  async createUploadUrl(): Promise<string> { return this.disabled(); }
  async verifyUpload(): Promise<void> { this.disabled(); }
  async promote(): Promise<void> { this.disabled(); }
  async createDownloadUrl(): Promise<string> { return this.disabled(); }
}
export class DisabledScanner implements MalwareScanner {
  async assertClean(): Promise<void> { throw new ServiceUnavailableException({ code: 'FILE_ATTACHMENTS_DISABLED' }); }
}
export const createPrivateObjectStorage = (): PrivateObjectStorage => {
  if (process.env.FILE_STORAGE_PROVIDER === 'disabled') return new DisabledPrivateObjectStorage();
  if (process.env.NODE_ENV === 'production' && process.env.FILE_STORAGE_PROVIDER !== 's3') throw new Error('FILE_STORAGE_PROVIDER_REQUIRED');
  return new S3PrivateObjectStorage();
};
export class DevelopmentCleanScanner implements MalwareScanner {
  async assertClean() {
    if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  }
}

export const createMalwareScanner = (): MalwareScanner => {
  if (process.env.FILE_STORAGE_PROVIDER === 'disabled') return new DisabledScanner();
  const provider = process.env.FILE_SCANNER_PROVIDER ?? 'development-clean';
  if (process.env.NODE_ENV === 'production' && provider === 'development-clean') throw new Error('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  if (provider === 'development-clean') return new DevelopmentCleanScanner();
  throw new Error(`FILE_SCANNER_PROVIDER_UNAVAILABLE:${provider}`);
};
