import { describe, expect, it } from 'vitest';
import { fileCapabilities, fileUploadPolicy } from './file-policy';
describe('file capability contract', () => {
  it('reports disabled storage without enabling uploads', () => { expect(fileCapabilities('disabled')).toEqual({ attachmentsEnabled: false, ...fileUploadPolicy }); });
  it('reports the same size and media policy enforced by upload validation', () => { expect(fileCapabilities('s3')).toEqual({ attachmentsEnabled: true, maxByteSize: 20971520, mediaTypes: ['application/pdf', 'image/jpeg', 'image/png'] }); });
});
