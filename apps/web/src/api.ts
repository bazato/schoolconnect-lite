export type Role = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
export type Membership = { id: string; schoolId: string | null; role: Role };
export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  deviceId: string;
  user: { id: string; displayName: string };
  memberships: Membership[];
  activeMembershipId: string;
};
export type AppContext = {
  principal: { userId: string; displayName: string; membershipId: string; schoolId: string | null; role: Role };
  school: { id: string; displayName: string; schoolCode: string; status: string } | null;
  memberships: Membership[];
};

const API_BASE = (import.meta.env.VITE_API_URL || 'https://schoolconnect-demo-api.onrender.com/api/v1').replace(/\/$/, '');
const SESSION_STORAGE_KEY = 'schoolconnect-web-session';
const DEVICE_ID = 'schoolconnect-web';

export const readSession = (): Session | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Session : null;
  } catch { return null; }
};
export const saveSession = (session: Session | null) => {
  if (session) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_STORAGE_KEY);
};
export const apiBaseUrl = API_BASE;
export const deviceId = DEVICE_ID;

function errorCode(payload: unknown, status: number) {
  if (payload && typeof payload === 'object') {
    const object = payload as { code?: unknown; message?: unknown };
    if (typeof object.code === 'string') return object.code;
    if (object.message && typeof object.message === 'object' && 'code' in object.message) {
      const code = (object.message as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return `HTTP_${status}`;
}

export async function apiRequest<T>(path: string, session: Session | null, onSession: (value: Session) => void,
  init: RequestInit = {}, canRefresh = true): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}), ...init.headers },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (response.status === 401 && session?.refreshToken && canRefresh && path !== '/auth/refresh') {
    try {
      const refreshed = await apiRequest<Omit<Session, 'deviceId' | 'activeMembershipId'>>('/auth/refresh', null, () => undefined,
        { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken, deviceId: session.deviceId }) }, false);
      const next: Session = { ...session, ...refreshed, deviceId: session.deviceId,
        activeMembershipId: session.activeMembershipId };
      saveSession(next);
      onSession(next);
      return apiRequest<T>(path, next, onSession, init, false);
    } catch {
      saveSession(null);
      throw new Error('SESSION_EXPIRED_SIGN_IN_AGAIN');
    }
  }
  if (!response.ok) throw new Error(errorCode(payload, response.status));
  return payload as T;
}

export async function requestOtp(phoneE164: string, invitationCode: string) {
  const request = async (withInvitation: boolean) => apiRequest<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number; developmentCode?: string }>(
    '/auth/otp/request', null, () => undefined, { method: 'POST', body: JSON.stringify({ phoneE164: phoneE164.replace(/\s/g, ''),
      ...(withInvitation && invitationCode ? { invitationCode } : {}) }) });
  try { return await request(true); }
  catch (error) {
    if (invitationCode && error instanceof Error && /INVITATION_OR_PHONE_INVALID/.test(error.message)) return request(false);
    throw error;
  }
}

export async function verifyOtp(challengeId: string, code: string): Promise<Session> {
  const verified = await apiRequest<Omit<Session, 'deviceId' | 'activeMembershipId'>>('/auth/otp/verify', null, () => undefined,
    { method: 'POST', body: JSON.stringify({ challengeId, code, deviceId: DEVICE_ID }) });
  const session: Session = { ...verified, deviceId: DEVICE_ID, activeMembershipId: verified.memberships[0]?.id ?? '' };
  saveSession(session);
  return session;
}
