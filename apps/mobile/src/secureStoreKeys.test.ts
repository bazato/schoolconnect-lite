import { describe, expect, it } from 'vitest';
import { offlineSecretSecureKey, SESSION_SECURE_KEY } from './secureStoreKeys';

const validSecureStoreKey = /^[A-Za-z0-9._-]+$/;

describe('native SecureStore keys', () => {
  it('uses a valid key for the login session', () => {
    expect(SESSION_SECURE_KEY).toMatch(validSecureStoreKey);
    expect(SESSION_SECURE_KEY).toBe('schoolconnect.session');
  });

  it('uses a valid, user-scoped offline encryption key', () => {
    const first = offlineSecretSecureKey('8dbb5173-f8b2-45bb-a70a-4c423d33a755');
    const second = offlineSecretSecureKey('a70ce03f-067b-497d-b83b-a2fe5a4e4a99');
    expect(first).toMatch(validSecureStoreKey);
    expect(second).toMatch(validSecureStoreKey);
    expect(first).not.toBe(second);
  });

  it('rejects unsafe or empty user IDs before accessing native storage', () => {
    expect(() => offlineSecretSecureKey('')).toThrow('INVALID_OFFLINE_USER_ID');
    expect(() => offlineSecretSecureKey('school:parent')).toThrow('INVALID_OFFLINE_USER_ID');
  });
});
