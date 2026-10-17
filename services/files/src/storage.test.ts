import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMalwareScanner, createPrivateObjectStorage, DevelopmentCleanScanner } from './storage';

const originalEnvironment = process.env.NODE_ENV;
const originalProvider = process.env.FILE_SCANNER_PROVIDER;
afterEach(() => {
  vi.unstubAllEnvs();
  if (originalEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment;
  if (originalProvider === undefined) delete process.env.FILE_SCANNER_PROVIDER;
  else process.env.FILE_SCANNER_PROVIDER = originalProvider;
});

describe('private file scanner policy', () => {
  it('permits the development adapter only outside production', async () => {
    process.env.NODE_ENV = 'development';
    await expect(new DevelopmentCleanScanner().assertClean()).resolves.toBe('development-only');
    process.env.NODE_ENV = 'production';
    await expect(new DevelopmentCleanScanner().assertClean()).rejects.toThrow('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  });

  it('fails closed for unconfigured scanner providers', () => {
    process.env.FILE_SCANNER_PROVIDER = 'missing-provider';
    expect(() => createMalwareScanner()).toThrow('FILE_SCANNER_PROVIDER_UNAVAILABLE');
  });
  it('rejects the development scanner at production construction time', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FILE_SCANNER_PROVIDER', 'development-clean');
    expect(() => createMalwareScanner()).toThrow('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  });
  it('explicit disabled storage never signs, uploads, promotes or scans files', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FILE_STORAGE_PROVIDER', 'disabled');
    const storage = createPrivateObjectStorage();
    await expect(storage.createUploadUrl('key', 'application/pdf', 1, 'checksum')).rejects.toThrow();
    await expect(storage.read('key',1)).rejects.toThrow();
    await expect(storage.putChecked('key',Buffer.from('x'),'application/pdf','checksum')).rejects.toThrow();
    await expect(storage.createDownloadUrl('key')).rejects.toThrow();
    await expect(createMalwareScanner().assertClean(Buffer.from('key'))).rejects.toThrow();
  });
});
