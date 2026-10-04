import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureItems = vi.hoisted(() => new Map<string, string>());
const validSecureStoreKey = /^[A-Za-z0-9._-]+$/;

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async () => { throw new Error('Native sessions must use SecureStore'); }),
  setItem: vi.fn(async () => { throw new Error('Native sessions must use SecureStore'); }),
} }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: async (key: string) => {
    if (!validSecureStoreKey.test(key)) throw new Error('Invalid key provided to SecureStore');
    return secureItems.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (!validSecureStoreKey.test(key)) throw new Error('Invalid key provided to SecureStore');
    secureItems.set(key, value);
  },
}));
vi.mock('./offline', () => ({}));

import { loadSession, saveSession, type MobileSession } from './api';

describe('Android session persistence', () => {
  beforeEach(() => secureItems.clear());

  it('loads an empty session and securely saves a verified session', async () => {
    expect(await loadSession()).toBeNull();
    const session: MobileSession = {
      accessToken: 'access', refreshToken: 'refresh', expiresInSeconds: 900,
      user: { id: 'user-1', displayName: 'Teacher' }, memberships: [],
    };
    await saveSession(session);
    expect(await loadSession()).toEqual(session);
    expect([...secureItems.keys()]).toEqual(['schoolconnect.session']);
  });
});
