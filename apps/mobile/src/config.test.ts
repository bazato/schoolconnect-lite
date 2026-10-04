import { describe, expect, it } from 'vitest';
import { isDemoMode, resolveApiUrl } from './config';

describe('mobile runtime mode', () => {
  it('uses the real API when the setting is absent', () => {
    expect(isDemoMode(undefined)).toBe(false);
  });

  it('uses the real API when explicitly disabled', () => {
    expect(isDemoMode('false')).toBe(false);
  });

  it('enables mock data only when explicitly requested', () => {
    expect(isDemoMode('true')).toBe(true);
  });
});

describe('mobile API URL', () => {
  it('uses the configured remote gateway on Android without a browser location', () => {
    expect(resolveApiUrl('https://example.com/api/v1', 'android')).toBe('https://example.com/api/v1');
  });

  it('does not read the browser location on native platforms', () => {
    expect(resolveApiUrl(undefined, 'android', undefined)).toBe('http://localhost:3000/api/v1');
  });

  it('uses the browser hostname only for web previews', () => {
    expect(resolveApiUrl(undefined, 'web', { hostname: 'preview.test' })).toBe('http://preview.test:3000/api/v1');
    expect(resolveApiUrl(undefined, 'web')).toBe('http://localhost:3000/api/v1');
  });
});
