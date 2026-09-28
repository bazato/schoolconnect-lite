import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
export class DevelopmentCleanScanner implements MalwareScanner {
  async assertClean() {
    if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  }
}

export const createMalwareScanner = (): MalwareScanner => {
  const provider = process.env.FILE_SCANNER_PROVIDER ?? 'development-clean';
  if (provider === 'development-clean') return new DevelopmentCleanScanner();
  throw new Error(`FILE_SCANNER_PROVIDER_UNAVAILABLE:${provider}`);
};
