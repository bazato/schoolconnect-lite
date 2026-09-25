import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Role } from './domain';
import { isDemoMode } from './config';

const browserHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${browserHost}:3000/api/v1`;
export const demoMode = isDemoMode(process.env.EXPO_PUBLIC_DEMO_MODE);
const SESSION_KEY = 'schoolconnect:session';

export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; displayName: string };
  memberships: Array<{ id: string; schoolId: string | null; role: Role }>;
};

export type ApiChild = {
  id: string;
  displayName: string;
  admissionNumber: string;
  classId: string;
  className: string;
  schoolName: string;
};

export type ApiTimelinePost = {
  id: string;
  postType: 'HOMEWORK' | 'RESULT' | 'ANNOUNCEMENT';
  status: string;
  publishedAt: string;
  revisionNumber: number;
  title: string;
  body: string;
  subjectCode?: string;
  examName?: string;
  dueDate?: string;
  urgent: boolean;
  attachments: Array<{ fileId: string; studentId?: string; privacyClassification: string }>;
};

export type ApiTeachingAssignment = {
  assignmentId: string;
  classId: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  canPublishResults: boolean;
  canPublishAnnouncements: boolean;
  canRecordAttendance: boolean;
};

export type ApiTeacherPost = {
  id: string;
  postType: 'HOMEWORK' | 'RESULT' | 'ANNOUNCEMENT';
  status: string;
  publishedAt: string;
  revisionNumber: number;
  title: string;
  body: string;
  subjectCode?: string;
  examName?: string;
  dueDate?: string;
  urgent: boolean;
  recipientCount: number;
};

export type ApiSchool = {
  id: string;
  schoolCode: string;
  displayName: string;
  timezone: string;
  status: string;
  createdAt?: string;
};

export type ApiSchoolClass = {
  id: string;
  classCode: string;
  displayName: string;
  academicYear: string;
  status: string;
};

export type ProvisionedAccount = {
  userId: string;
  membershipId: string;
  role: Role;
  invitationCode: string;
  expiresAt: string;
};

async function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({ code: 'INVALID_SERVER_RESPONSE' })) as T & { message?: unknown; code?: string };
  if (!response.ok) {
    const serverMessage = typeof payload.message === 'object' && payload.message && 'code' in payload.message
      ? String((payload.message as { code?: string }).code)
      : payload.code ?? `HTTP_${response.status}`;
    throw new Error(serverMessage);
  }
  return payload;
}

export function requestOtp(phoneE164: string, invitationCode: string) {
  return request<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number; developmentCode?: string }>('/auth/otp/request', {
    method: 'POST', body: JSON.stringify({ phoneE164: phoneE164.replace(/\s/g, ''), invitationCode }),
  });
}

export function verifyOtp(challengeId: string, code: string) {
  return request<MobileSession>('/auth/otp/verify', {
    method: 'POST', body: JSON.stringify({ challengeId, code, deviceId: `schoolconnect-${Platform.OS}` }),
  });
}

export async function saveSession(session: MobileSession) {
  const value = JSON.stringify(session);
  if (Platform.OS === 'web') await AsyncStorage.setItem(SESSION_KEY, value);
  else await SecureStore.setItemAsync(SESSION_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function loadSession(): Promise<MobileSession | null> {
  const value = Platform.OS === 'web' ? await AsyncStorage.getItem(SESSION_KEY) : await SecureStore.getItemAsync(SESSION_KEY);
  return value ? JSON.parse(value) as MobileSession : null;
}

export async function clearSession() {
  if (Platform.OS === 'web') await AsyncStorage.removeItem(SESSION_KEY);
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

export const mobileApi = {
  context: (session: MobileSession) => request<{ principal: { role: Role }; school: ApiSchool | null; memberships: MobileSession['memberships'] }>('/me/context', undefined, session.accessToken),
  switchRole: (session: MobileSession, membershipId: string) => request<{ accessToken: string; activeMembership: MobileSession['memberships'][number] }>('/auth/switch-role', {
    method: 'POST', body: JSON.stringify({ membershipId }),
  }, session.accessToken),
  children: (session: MobileSession) => request<ApiChild[]>('/me/children', undefined, session.accessToken),
  teachingScope: (session: MobileSession) => request<ApiTeachingAssignment[]>('/me/teaching-scope', undefined, session.accessToken),
  teacherPosts: (session: MobileSession) => request<ApiTeacherPost[]>('/teacher-posts', undefined, session.accessToken),
  timeline: (session: MobileSession, studentId: string) => request<ApiTimelinePost[]>(`/timeline/${studentId}`, undefined, session.accessToken),
  notifications: (session: MobileSession) => request('/notifications', undefined, session.accessToken),
  publish: (session: MobileSession, payload: Record<string, unknown>) => request<{ id: string; revisionId: string; status: string; recipientCount: number }>('/posts', { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
  revisePost: (session: MobileSession, postId: string, payload: Record<string, unknown>) => request<{ id: string; revisionId: string; revisionNumber: number; status: string }>(`/posts/${postId}/revisions`, { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
  submitAttendance: (session: MobileSession, payload: Record<string, unknown>) => request('/attendance/batches', { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
  acknowledgeAbsence: (session: MobileSession, eventId: string, payload: Record<string, unknown>) => request(`/attendance/events/${eventId}/acknowledgements`, { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
  schools: (session: MobileSession) => request<ApiSchool[]>('/admin/schools', undefined, session.accessToken),
  createSchool: (session: MobileSession, payload: Record<string, unknown>) => request<{ school: ApiSchool & { created: boolean }; administrator: ProvisionedAccount }>('/admin/schools', { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
  adminClasses: (session: MobileSession) => request<ApiSchoolClass[]>('/admin/classes', undefined, session.accessToken),
  createClass: (session: MobileSession, payload: Record<string, unknown>) => request<ApiSchoolClass>('/admin/classes', { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
  createTeacher: (session: MobileSession, payload: Record<string, unknown>) => request<{ teacher: ProvisionedAccount; assignment: ApiTeachingAssignment }>('/admin/teachers', { method: 'POST', body: JSON.stringify(payload) }, session.accessToken),
};
