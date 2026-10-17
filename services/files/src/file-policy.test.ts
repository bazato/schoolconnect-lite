import { describe, expect, it } from 'vitest';
import { fileCapabilities, fileUploadPolicy } from './file-policy';
describe('file capability contract', () => {
  it('reports disabled storage without enabling uploads', () => { expect(fileCapabilities('disabled')).toEqual({ attachmentsEnabled: false, ...fileUploadPolicy }); });
  it('reports separate original-upload and checked-storage limits', () => { expect(fileCapabilities('s3')).toEqual({ attachmentsEnabled: true, maxByteSize: 5000000,maxStoredByteSize:3400000,mediaTypes: ['application/pdf', 'image/jpeg', 'image/png'] }); });
});
