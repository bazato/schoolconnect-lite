// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession, loginPasscode } from './api';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const parent = { id: 'parent', schoolId: 'school', role: 'PARENT' };
const admin = { id: 'admin', schoolId: 'school', role: 'SCHOOL_ADMIN' };
const verified = { accessToken: 'parent-access', refreshToken: 'refresh', expiresInSeconds: 600, user: { id: 'one-user', displayName: 'School administrator and parent' }, memberships: [parent, admin] };

describe('portal login role resolution', () => {
  it('selects an assigned administrative role when the initial login role is parent', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/passcode/login')) return new Response(JSON.stringify(verified), { status: 201 });
      expect(url.endsWith('/auth/switch-role')).toBe(true); expect(JSON.parse(String(init?.body))).toEqual({ membershipId: 'admin' });
      return new Response(JSON.stringify({ accessToken: 'admin-access', expiresInSeconds: 600, activeMembership: admin }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = await loginPasscode('+919876543210', '1234');
    expect(session.activeMembershipId).toBe('admin'); expect(session.accessToken).toBe('admin-access'); expect(readSession()?.activeMembershipId).toBe('admin');
  });

  it('directs a parent-only account to mobile and does not save a portal session', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/passcode/login') ? { ...verified, memberships: [parent] } : {}), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loginPasscode('+919876543210', '1234')).rejects.toThrow('Please use the mobile app');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/logout'))).toBe(true); expect(readSession()).toBeNull();
  });
});
