/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { MobileSession } from './api';

const native = vi.hoisted(() => ({ read: vi.fn(), put: vi.fn(), create: vi.fn(), complete: vi.fn(), digest: vi.fn(), platform: { OS: 'android' } }));
vi.mock('react-native', () => ({ Platform: native.platform }));
vi.mock('expo-file-system', () => ({ File: class { constructor(public uri: string) {} bytes() { return native.read(this.uri); } } }));
vi.mock('expo/fetch', () => ({ fetch: native.put }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: native.digest, randomUUID: () => 'owner-id' }));
vi.mock('./api', () => ({ mobileApi: { createFileUpload: native.create, completeFileUpload: native.complete } }));
import { attachmentErrorMessage, uploadPickedAttachment } from './attachmentUpload';
const session = { user: { id: 'teacher' } } as MobileSession;
const asset = { uri: 'file:///cache/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 4, lastModified: 1 };
const capabilities = { attachmentsEnabled: true, maxByteSize: 100, mediaTypes: ['application/pdf', 'image/png'] };
beforeEach(() => {
  vi.clearAllMocks(); native.platform.OS = 'android'; native.read.mockResolvedValue(new Uint8Array([0, 128, 255, 10]));
  native.digest.mockImplementation(async (_algorithm, bytes) => { expect(bytes).toBeInstanceOf(Uint8Array); return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer; });
  native.create.mockResolvedValue({ fileId: 'file-1', uploadSessionId: 'upload-1', upload: { url: 'https://private.example/signed-put', requiredHeaders: { 'content-type': 'application/pdf' } } });
  native.put.mockResolvedValue({ ok: true }); native.complete.mockResolvedValue({ fileId: 'file-1', status: 'READY' });
});
describe('native attachment upload regression', () => {
  it('reads native picker bytes, hashes exact binary bytes and sends those bytes to the presigned URL', async () => {
    const uploaded = await uploadPickedAttachment(session, asset, capabilities);
    expect(native.read).toHaveBeenCalledWith(asset.uri);
    expect(native.create).toHaveBeenCalledWith(session, expect.objectContaining({ byteSize: 4, checksumSha256: createHash('sha256').update(Buffer.from([0, 128, 255, 10])).digest('hex') }));
    expect(native.put).toHaveBeenCalledWith('https://private.example/signed-put', expect.objectContaining({ method: 'PUT', body: new Uint8Array([0, 128, 255, 10]) }));
    expect(uploaded).toEqual({ fileId: 'file-1', metadata: { name: 'report.pdf', byteSize: 4 } });
  });
  it('blocks disabled uploads before reading files or creating any upload session', async () => {
    await expect(uploadPickedAttachment(session, asset, { ...capabilities, attachmentsEnabled: false })).rejects.toThrow('FILE_ATTACHMENTS_DISABLED');
    expect(native.read).not.toHaveBeenCalled(); expect(native.create).not.toHaveBeenCalled();
  });
  it('uses actual bytes rather than trusting picker metadata', async () => {
    await uploadPickedAttachment(session, { ...asset, size: undefined }, capabilities);
    expect(native.create).toHaveBeenCalledWith(session, expect.objectContaining({ byteSize: 4 }));
  });
  it('rejects too-large files before reading and after checking actual bytes', async () => {
    await expect(uploadPickedAttachment(session, { ...asset, size: 101 }, capabilities)).rejects.toThrow('FILE_TOO_LARGE'); expect(native.read).not.toHaveBeenCalled();
    native.read.mockResolvedValue(new Uint8Array(101));
    await expect(uploadPickedAttachment(session, asset, capabilities)).rejects.toThrow('FILE_TOO_LARGE'); expect(native.create).not.toHaveBeenCalled();
  });
  it.each(['image/svg+xml', 'application/octet-stream'])('rejects unsupported media %s', async mimeType => {
    await expect(uploadPickedAttachment(session, { ...asset, mimeType }, capabilities)).rejects.toThrow('FILE_POLICY_REJECTED'); expect(native.read).not.toHaveBeenCalled();
  });
  it('never completes an unsuccessful S3 PUT', async () => {
    native.put.mockResolvedValue({ ok: false, status: 403 });
    await expect(uploadPickedAttachment(session, asset, capabilities)).rejects.toThrow('UPLOAD_HTTP_403'); expect(native.complete).not.toHaveBeenCalled();
  });
  it.each(['SCANNING', 'REJECTED'])('never marks %s files ready', async status => {
    native.complete.mockResolvedValue({ fileId: 'file-1', status });
    await expect(uploadPickedAttachment(session, asset, capabilities)).rejects.toThrow('FILE_NOT_READY');
  });
  it('does not display raw native stack traces, encrypted data or signed URLs', () => {
    expect(attachmentErrorMessage(new Error('fromCombined(secret-base64) stack at signed-url'))).not.toMatch(/secret|signed-url|fromCombined/);
    expect(attachmentErrorMessage(new Error('FILE_ATTACHMENTS_DISABLED'))).toContain('disabled on the server');
  });
  it('uses the browser File implementation only for web', async () => {
    native.platform.OS = 'web';
    await uploadPickedAttachment(session, { ...asset, file: new File([new Uint8Array([0, 128, 255, 10])], 'report.pdf') }, capabilities);
    expect(native.read).not.toHaveBeenCalled(); expect(native.create).toHaveBeenCalled();
  });
});
