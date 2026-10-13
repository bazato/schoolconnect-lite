import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({Platform:{OS:'android'}}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{}}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('./offline', () => ({}));
import { loginPasscode, requestOtp, setupPasscode, verifyOtp } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('mobile account authentication API', () => {
  it('uses the shared login endpoint with phone and four-digit passcode only', async () => {
    const fetchMock=vi.fn(async (_url:string,init?:RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({phoneE164:'+919876543210',passcode:'0123',deviceId:'schoolconnect-android'});
      return new Response(JSON.stringify({memberships:[{id:'parent',role:'PARENT'}]}),{status:201});
    }); vi.stubGlobal('fetch',fetchMock);
    expect((await loginPasscode('+91 98765 43210','0123')).activeMembershipId).toBe('parent');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/auth/passcode/login');
  });
  it('keeps OTP grant separate from the authenticated session and then submits passcode setup', async () => {
    const fetchMock=vi.fn(async (url:string,init?:RequestInit) => {
      if(url.endsWith('/otp/verify')) return new Response(JSON.stringify({setupToken:'grant',nextStep:'SET_PASSCODE'}));
      expect(JSON.parse(String(init?.body))).toEqual({setupToken:'grant',passcode:'0123',deviceId:'schoolconnect-android'});
      return new Response(JSON.stringify({accessToken:'session',memberships:[{id:'teacher'}]}));
    }); vi.stubGlobal('fetch',fetchMock);
    const grant=await verifyOtp('challenge','123456'); expect(grant).not.toHaveProperty('accessToken');
    expect((await setupPasscode(grant.setupToken,'0123')).activeMembershipId).toBe('teacher');
  });
  it('requests recovery OTP without a stale invitation',async () => {
    const fetchMock=vi.fn(async (_url:string,init?:RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({phoneE164:'+919876543210',purpose:'RESET'});
      return new Response(JSON.stringify({challengeId:'reset'}));
    }); vi.stubGlobal('fetch',fetchMock);
    await requestOtp('+919876543210','old-invitation','RESET');
  });
});
