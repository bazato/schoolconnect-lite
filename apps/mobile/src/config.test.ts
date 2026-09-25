import { describe, expect, it } from 'vitest';
import { isDemoMode } from './config';

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
