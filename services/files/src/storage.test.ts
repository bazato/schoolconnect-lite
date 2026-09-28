import { afterEach, describe, expect, it } from 'vitest';
import { createMalwareScanner, DevelopmentCleanScanner } from './storage';

const originalEnvironment = process.env.NODE_ENV;
const originalProvider = process.env.FILE_SCANNER_PROVIDER;
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment;
  if (originalProvider === undefined) delete process.env.FILE_SCANNER_PROVIDER;
  else process.env.FILE_SCANNER_PROVIDER = originalProvider;
});

describe('private file scanner policy', () => {
  it('permits the development adapter only outside production', async () => {
    process.env.NODE_ENV = 'development';
    await expect(new DevelopmentCleanScanner().assertClean()).resolves.toBeUndefined();
    process.env.NODE_ENV = 'production';
    await expect(new DevelopmentCleanScanner().assertClean()).rejects.toThrow('DEVELOPMENT_SCANNER_FORBIDDEN_IN_PRODUCTION');
  });

  it('fails closed for unconfigured scanner providers', () => {
    process.env.FILE_SCANNER_PROVIDER = 'missing-provider';
    expect(() => createMalwareScanner()).toThrow('FILE_SCANNER_PROVIDER_UNAVAILABLE');
  });
});
