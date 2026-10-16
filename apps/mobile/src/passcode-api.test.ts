import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({Platform:{OS:'android'}}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{}}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('./offline', () => ({}));
import { loginPasscode, requestOtp, setupPasscode, verifyOtp } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('mobile account authentication API', () => {
  it.each(['PARENT','TEACHER','SCHOOL_ADMIN'] as const)('uses the selected registered role instead of the first membership: %s',async(role)=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.endsWith('/auth/switch-role')) {
        expect(JSON.parse(String(init?.body))).toEqual({membershipId:role});
        return new Response(JSON.stringify({accessToken:`token-${role}`,expiresInSeconds:600,activeMembership:{id:role}}));
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({role});
      return new Response(JSON.stringify({accessToken:'initial',memberships:[{id:'admin',role:'PLATFORM_OWNER'},{id:role,role}]}));
    });
    vi.stubGlobal('fetch',fetchMock);
    const session=await loginPasscode('+919876543210','0123',role);
    expect(session.activeMembershipId).toBe(role);expect(session.accessToken).toBe(`token-${role}`);
  });
  it('opens a mobile role for a shared admin/teacher phone using a server-authorized switch',async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/auth/switch-role') ?
      (expect(JSON.parse(String(init?.body))).toEqual({membershipId:'teacher'}),expect((init?.headers as Record<string,string>).authorization).toBe('Bearer initial'),new Response(JSON.stringify({accessToken:'teacher-token',expiresInSeconds:600,activeMembership:{id:'teacher'}}))) :
      new Response(JSON.stringify({accessToken:'initial',memberships:[{id:'admin',role:'SCHOOL_ADMIN'},{id:'teacher',role:'TEACHER'}]})));
    vi.stubGlobal('fetch',fetchMock);const result=await loginPasscode('+919876543210','0123');expect(result.activeMembershipId).toBe('teacher');expect(result.accessToken).toBe('teacher-token');expect(fetchMock).toHaveBeenCalledTimes(2);
  });
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
