import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Role } from './domain';
import { isDemoMode, resolveApiUrl } from './config';
import { SESSION_SECURE_KEY } from './secureStoreKeys';
import { withReturningMemberFallback } from './otp-request';
import { cacheChildren, cachedChildren, cachePublicTimeline, cachedPublicTimeline, cacheScopedRead, cachedScopedRead, clearOfflineUserData, queueMutation, queuedMutations, replayMutations, type QueuedMutation } from './offline';

const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, Platform.OS, typeof window !== 'undefined' ? window.location : undefined);
export const demoMode = isDemoMode(process.env.EXPO_PUBLIC_DEMO_MODE);
const SESSION_KEY = Platform.OS === 'web' ? 'schoolconnect:session' : SESSION_SECURE_KEY;
const DEVICE_ID = `schoolconnect-${Platform.OS}`;

export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; displayName: string };
  memberships: Array<{ id: string; schoolId: string | null; role: Role }>;
  activeMembershipId?: string;
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
  canPublishSchoolWide?: boolean;
  canPublishGradeWide?: boolean;
  canPublishUrgent?: boolean;
};

export type ApiTeacherPost = {
  id: string;
  classId?: string;
  postType: 'HOMEWORK' | 'RESULT' | 'ANNOUNCEMENT';
  status: string;
  publishedAt: string | null;
  scheduledFor?: string | null;
  revisionNumber: number;
  title: string;
  body: string;
  subjectCode?: string;
  examName?: string;
  dueDate?: string;
  urgent: boolean;
  recipientCount: number;
};

export type ApiDraft = { id: string; classId: string; postType: 'HOMEWORK' | 'RESULT' | 'ANNOUNCEMENT'; version: number; updatedAt: string; payload: { title?: string; body?: string; subjectCode?: string; dueDate?: string; examName?: string; urgent?: boolean; audienceType?: 'CLASS' | 'GRADE' | 'SCHOOL'; scheduledFor?: string; targetStudentId?: string; uploadedFileId?: string; uploadMetadata?: { name: string; byteSize: number } } };

export type ApiSchool = {
  id: string;
  schoolCode: string;
  displayName: string;
  timezone: string;
  status: string;
  createdAt?: string;
  scheduledAnnouncementsEnabled?: boolean;
  schoolWideAnnouncementsEnabled?: boolean;
  gradeWideAnnouncementsEnabled?: boolean;
  urgentAnnouncementsEnabled?: boolean;
};

export type ApiSchoolClass = {
  id: string;
  classCode: string;
  displayName: string;
  academicYear: string;
  status: string;
  gradeCode?: string;
};

export type ApiMember = { userId: string; membershipId: string; displayName: string; phoneE164: string; role: Role; status: string };
export type ApiStudent = { id: string; displayName: string; admissionNumber: string; classId: string; className: string; guardianCount: number; status: string };
export type ApiAssignment = ApiTeachingAssignment & { status: string; canPublishSchoolWide: boolean; canPublishGradeWide: boolean; canPublishUrgent: boolean };
export type ApiLeaveRequest = { id: string; studentId: string; studentName: string; guardianUserId: string; attendanceEventId: string; classId: string; attendanceDate: string; reason: string; status: string; reviewNote?: string; createdAt: string };

export type ApiRosterStudent = { id: string; displayName: string; admissionNumber: string };
export type ApiAttendanceEvent = { id: string; attendanceDate: string; attendanceStatus: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE'; revisionNumber: number; createdAt: string; responseType?: 'ACKNOWLEDGED' | 'LEAVE_SUBMITTED' | null; responseReason?: string | null; leaveStatus?: string | null; correctionReason?: string | null };
export type ApiNotification = { id: string; notificationType: string; resourceType: string; resourceId: string; studentId?: string; title: string; body: string; deepLink: string; status: string; readAt?: string; createdAt: string };

export type ProvisionedAccount = {
  userId: string;
  membershipId: string;
  role: Role;
  invitationCode: string;
  expiresAt: string;
};

let refreshInFlight: Promise<MobileSession> | null = null;
export const isNetworkError = (error: unknown) => error instanceof TypeError || (error instanceof Error && (error.name === 'AbortError' || /SERVICE_UNAVAILABLE|Failed to fetch|Network request failed/.test(error.message)));

async function transport(path: string, init: RequestInit): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init,signal: init.signal ?? controller.signal });
    const payload = await response.json().catch((error: unknown) => { if (isNetworkError(error)) throw error; return { code: 'INVALID_SERVER_RESPONSE' }; });
    return { response,payload };
  } finally { clearTimeout(timer); }
}

async function request<T>(path: string, init?: RequestInit, session?: MobileSession, allowRefresh = true): Promise<T> {
  const result = await transport(path, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...init?.headers,
    },
  });
  const response = result.response;
  const payload = result.payload as T & { message?: unknown; code?: string };
  if (!response.ok) {
    const serverMessage = typeof payload.message === 'object' && payload.message && 'code' in payload.message
      ? String((payload.message as { code?: string }).code)
      : payload.code ?? `HTTP_${response.status}`;
    if (response.status === 401 && session && allowRefresh) {
      try {
        refreshInFlight ??= request<MobileSession>('/auth/refresh', {
          method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken, deviceId: DEVICE_ID }),
        }, undefined, false).then(async (refreshed) => {
          Object.assign(session, refreshed);
          await saveSession(session);
          return session;
        }).finally(() => { refreshInFlight = null; });
        await refreshInFlight;
        return request<T>(path, init, session, false);
      } catch (refreshError) {
        if (isNetworkError(refreshError)) throw refreshError;
        await clearSession();
      }
    }
    throw new Error(serverMessage);
  }
  return payload;
}

export async function requestOtp(phoneE164: string, invitationCode: string) {
  const normalizedPhone = phoneE164.replace(/\s/g, '');
  const send = (code: string) => request<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number; developmentCode?: string }>('/auth/otp/request', {
    method: 'POST', body: JSON.stringify({ phoneE164: normalizedPhone, invitationCode: code }),
  });
  return withReturningMemberFallback(invitationCode, send);
}

export function verifyOtp(challengeId: string, code: string) {
  return request<MobileSession>('/auth/otp/verify', {
    method: 'POST', body: JSON.stringify({ challengeId, code, deviceId: DEVICE_ID }),
  }).then((session) => ({ ...session, activeMembershipId: session.memberships[0]?.id }));
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
  const session = await loadSession().catch(() => null);
  if (session) await clearOfflineUserData(session.user.id);
  if (Platform.OS === 'web') await AsyncStorage.removeItem(SESSION_KEY);
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function resilientMutation<T>(session: MobileSession, path: string, body: Record<string, unknown>, allowQueue: boolean): Promise<T | { status: 'QUEUED' }> {
  try { return await request<T>(path, { method: 'POST', body: JSON.stringify(body) }, session); }
  catch (error) {
    const networkFailure = isNetworkError(error);
    if (!networkFailure || !allowQueue) throw error;
    const membershipId = session.activeMembershipId ?? session.memberships[0]?.id;
    const membership = session.memberships.find((item) => item.id === membershipId);
    if (!membership || !membershipId) throw error;
    const entry: QueuedMutation = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, userId: session.user.id,
      membershipId, schoolId: membership.schoolId, method: 'POST', path, body, createdAt: new Date().toISOString(), state: 'PENDING' };
    await queueMutation(entry);
    return { status: 'QUEUED' };
  }
}

async function scopedRead<T>(session: MobileSession, path: string, permittedCache: (value: T) => T = (value) => value): Promise<T> {
  const membership = session.memberships.find((item) => item.id === session.activeMembershipId) ?? session.memberships[0];
  try {
    const value = await request<T>(path, undefined, session);
    if (membership?.schoolId) await cacheScopedRead(session.user.id, membership.schoolId, membership.id, path, permittedCache(value)).catch(() => undefined);
    return value;
  } catch (error) {
    if (!isNetworkError(error) || !membership?.schoolId) throw error;
    const cached = await cachedScopedRead<T>(session.user.id, membership.schoolId, membership.id, path);
    if (cached === null) throw error;
    return permittedCache(cached);
  }
}

export const mobileApi = {
  context: (session: MobileSession) => request<{ principal: { role: Role }; school: ApiSchool | null; memberships: MobileSession['memberships'] }>('/me/context', undefined, session),
  switchRole: (session: MobileSession, membershipId: string) => request<{ accessToken: string; expiresInSeconds: number; activeMembership: MobileSession['memberships'][number] }>('/auth/switch-role', {
    method: 'POST', body: JSON.stringify({ membershipId }),
  }, session),
  logout: (session: MobileSession) => request<{ revoked: boolean }>('/auth/logout', { method: 'POST' }, session, false),
  children: async (session: MobileSession, onNetworkStatus?: (online: boolean) => void) => {
    const membership = session.memberships.find((item) => item.id === session.activeMembershipId) ?? session.memberships[0];
    try {
      const items = await request<ApiChild[]>('/me/children', undefined, session);
      if (membership?.schoolId) await cacheChildren(session.user.id, membership.schoolId, items).catch(() => undefined);
      onNetworkStatus?.(true);
      return items;
    } catch (error) {
      if (!isNetworkError(error) || !membership?.schoolId) throw error;
      onNetworkStatus?.(false);
      return cachedChildren<ApiChild>(session.user.id, membership.schoolId);
    }
  },
  teachingScope: (session: MobileSession) => scopedRead<ApiTeachingAssignment[]>(session, '/me/teaching-scope'),
  teacherHome: (session: MobileSession) => scopedRead<{
    teachingScope: ApiTeachingAssignment[]; posts: ApiTeacherPost[]; drafts: ApiDraft[]; notifications: ApiNotification[];
  }>(session, '/bff/teacher/home', (value) => ({ ...value,
    posts: value.posts.filter((item) => item.postType !== 'RESULT'),
    drafts: value.drafts.filter((item) => item.postType !== 'RESULT'),
  })),
  teacherPosts: (session: MobileSession) => scopedRead<ApiTeacherPost[]>(session, '/teacher-posts', (items) => items.filter((item) => item.postType !== 'RESULT')),
  timeline: async (session: MobileSession, studentId: string, onNetworkStatus?: (online: boolean) => void) => {
    const membership = session.memberships.find((item) => item.id === session.activeMembershipId) ?? session.memberships[0];
    try { const items = await request<ApiTimelinePost[]>(`/timeline/${studentId}`, undefined, session); if (membership?.schoolId) await cachePublicTimeline(session.user.id, membership.schoolId, studentId, items).catch(() => undefined); onNetworkStatus?.(true); return items; }
    catch (error) { if (!isNetworkError(error) || !membership?.schoolId) throw error; onNetworkStatus?.(false); return cachedPublicTimeline<ApiTimelinePost>(session.user.id, membership.schoolId, studentId); }
  },
  notifications: (session: MobileSession) => request('/notifications', undefined, session),
  postDetail: (session: MobileSession, postId: string, studentId: string) => request<ApiTimelinePost>(`/posts/${postId}?studentId=${encodeURIComponent(studentId)}`, undefined, session),
  markPostViewed: (session: MobileSession, postId: string, studentId: string) => request(`/posts/${postId}/view`, { method: 'POST', body: JSON.stringify({ studentId }) }, session),
  publish: (session: MobileSession, payload: Record<string, unknown>) => resilientMutation<{ id: string; revisionId: string; status: string; recipientCount: number }>(session, '/posts', payload, payload.postType !== 'RESULT' && !((payload.attachments as unknown[] | undefined)?.length)),
  revisePost: (session: MobileSession, postId: string, payload: Record<string, unknown>, eligibleOffline = true) => resilientMutation<{ id: string; revisionId: string; revisionNumber: number; status: string }>(session, `/posts/${postId}/revisions`, payload, eligibleOffline),
  saveDraft: (session: MobileSession, payload: Record<string, unknown>) => request<{ id: string; version: number; updatedAt: string }>('/drafts', { method: 'POST', body: JSON.stringify(payload) }, session),
  drafts: (session: MobileSession) => scopedRead<ApiDraft[]>(session, '/drafts', (items) => items.filter((item) => item.postType !== 'RESULT')),
  deleteDraft: (session: MobileSession, draftId: string) => request<{ deleted: boolean }>(`/drafts/${draftId}/delete`, { method: 'POST' }, session),
  submitAttendance: (session: MobileSession, payload: Record<string, unknown>) => resilientMutation(session, '/attendance/batches', payload, true),
  acknowledgeAbsence: (session: MobileSession, eventId: string, payload: Record<string, unknown>) => resilientMutation(session, `/attendance/events/${eventId}/acknowledgements`, payload, true),
  attendanceRoster: (session: MobileSession, classId: string) => scopedRead<ApiRosterStudent[]>(session, `/attendance/roster?classId=${encodeURIComponent(classId)}`),
  attendanceVersion: (session: MobileSession, classId: string, attendanceDate: string) => scopedRead<{ version: number }>(session, `/attendance/version?classId=${encodeURIComponent(classId)}&attendanceDate=${encodeURIComponent(attendanceDate)}`),
  attendanceHistory: (session: MobileSession, studentId: string) => scopedRead<ApiAttendanceEvent[]>(session, `/attendance/students/${studentId}`),
  attendanceFollowUps: (session: MobileSession, classId: string, attendanceDate: string) => request<Array<{ attendanceEventId: string; studentId: string; studentName: string; responseStatus: 'PENDING' | 'ACKNOWLEDGED'; responseCount: number }>>(`/attendance/follow-ups?classId=${encodeURIComponent(classId)}&attendanceDate=${encodeURIComponent(attendanceDate)}`, undefined, session),
  attendanceEvent: (session: MobileSession, eventId: string) => scopedRead<{ id: string; attendanceDate: string; attendanceStatus: string; studentId: string; createdAt: string }>(session, `/attendance/events/${eventId}`),
  notificationInbox: (session: MobileSession) => request<ApiNotification[]>('/notifications', undefined, session),
  markNotificationRead: (session: MobileSession, id: string) => request<{ id: string; readAt: string }>(`/notifications/${id}/read`, { method: 'POST' }, session),
  createFileUpload: (session: MobileSession, payload: { ownerId: string; fileName: string; mediaType: string; byteSize: number; checksumSha256: string }) => request<{ fileId: string; uploadSessionId: string; upload: { url: string; requiredHeaders: Record<string, string> } }>('/files/uploads', { method: 'POST', body: JSON.stringify({ ...payload, ownerType: 'POST' }) }, session),
  completeFileUpload: (session: MobileSession, uploadSessionId: string) => request<{ fileId: string; status: string }>(`/files/uploads/${uploadSessionId}/complete`, { method: 'POST' }, session),
  fileAccess: (session: MobileSession, fileId: string, studentId?: string) => request<{ url: string; expiresInSeconds: number }>(`/files/${fileId}/access`, { method: 'POST', body: JSON.stringify({ studentId }) }, session),
  schools: (session: MobileSession) => request<ApiSchool[]>('/admin/schools', undefined, session),
  createSchool: (session: MobileSession, payload: Record<string, unknown>) => request<{ school: ApiSchool & { created: boolean }; administrator: ProvisionedAccount }>('/admin/schools', { method: 'POST', body: JSON.stringify(payload) }, session),
  updateSchool: (session: MobileSession, schoolId: string, payload: Record<string, unknown>) => request<ApiSchool>(`/admin/schools/${schoolId}`, { method: 'PATCH', body: JSON.stringify(payload) }, session),
  platformOwners: (session: MobileSession) => request<ApiMember[]>('/admin/platform-owners', undefined, session),
  createPlatformOwner: (session: MobileSession, payload: Record<string, unknown>) => request<ProvisionedAccount>('/admin/platform-owners', { method: 'POST', body: JSON.stringify(payload) }, session),
  updatePlatformOwner: (session: MobileSession, membershipId: string, payload: Record<string, unknown>) => request<ApiMember>(`/admin/platform-owners/${membershipId}`, { method: 'PATCH', body: JSON.stringify(payload) }, session),
  schoolAdmins: (session: MobileSession, schoolId: string) => request<ApiMember[]>(`/admin/schools/${schoolId}/admins`, undefined, session),
  createSchoolAdmin: (session: MobileSession, schoolId: string, payload: Record<string, unknown>) => request<ProvisionedAccount>(`/admin/schools/${schoolId}/admins`, { method: 'POST', body: JSON.stringify(payload) }, session),
  updateSchoolAdmin: (session: MobileSession, schoolId: string, membershipId: string, payload: Record<string, unknown>) => request<ApiMember>(`/admin/schools/${schoolId}/admins/${membershipId}`, { method: 'PATCH', body: JSON.stringify(payload) }, session),
  reissueSchoolAdmin: (session: MobileSession, schoolId: string, membershipId: string) => request<{ invitationCode: string; expiresAt: string }>(`/admin/schools/${schoolId}/admins/${membershipId}/reissue-invitation`, { method: 'POST' }, session),
  reissuePlatformOwner: (session: MobileSession, membershipId: string) => request<{ invitationCode: string; expiresAt: string }>(`/admin/platform-owners/${membershipId}/reissue-invitation`, { method: 'POST' }, session),
  adminClasses: (session: MobileSession) => request<ApiSchoolClass[]>('/admin/classes', undefined, session),
  createClass: (session: MobileSession, payload: Record<string, unknown>) => request<ApiSchoolClass>('/admin/classes', { method: 'POST', body: JSON.stringify(payload) }, session),
  updateConfiguration: (session: MobileSession, payload: Record<string, unknown>) => request('/admin/configuration', { method: 'PATCH', body: JSON.stringify(payload) }, session),
  rolloverAcademicYear: (session: MobileSession, fromYear: string, toYear: string) => request<{ classesCreated: number }>('/admin/academic-years/rollover', { method: 'POST', body: JSON.stringify({ fromYear, toYear }) }, session),
  adminTeachers: (session: MobileSession) => request<ApiMember[]>('/admin/teachers', undefined, session),
  adminParents: (session: MobileSession) => request<ApiMember[]>('/admin/parents', undefined, session),
  updateMember: (session: MobileSession, membershipId: string, payload: Record<string, unknown>) => request<ApiMember>(`/admin/members/${membershipId}`, { method: 'PATCH', body: JSON.stringify(payload) }, session),
  reissueInvitation: (session: MobileSession, membershipId: string) => request<{ invitationCode: string; expiresAt: string }>(`/admin/members/${membershipId}/reissue-invitation`, { method: 'POST' }, session),
  teacherAssignments: (session: MobileSession, membershipId: string) => request<ApiAssignment[]>(`/admin/teachers/${membershipId}/assignments`, undefined, session),
  updateAssignment: (session: MobileSession, assignmentId: string, payload: Record<string, unknown>) => request<ApiAssignment>(`/admin/assignments/${assignmentId}`, { method: 'PATCH', body: JSON.stringify(payload) }, session),
  createTeacher: (session: MobileSession, payload: Record<string, unknown>) => request<{ teacher: ProvisionedAccount; assignment: ApiTeachingAssignment }>('/admin/teachers', { method: 'POST', body: JSON.stringify(payload) }, session),
  createParent: (session: MobileSession, payload: Record<string, unknown>) => request<{ parent: ProvisionedAccount; student: { studentId: string; displayName: string; admissionNumber: string; classId: string } }>('/admin/parents', { method: 'POST', body: JSON.stringify(payload) }, session),
  adminStudents: (session: MobileSession) => request<ApiStudent[]>('/admin/students', undefined, session),
  updateStudent: (session: MobileSession, studentId: string, payload: Record<string, unknown>) => request<ApiStudent>(`/admin/students/${studentId}`, { method: 'PATCH', body: JSON.stringify(payload) }, session),
  linkGuardian: (session: MobileSession, studentId: string, guardianUserId: string, active: boolean, relationship?: string) => request(`/admin/students/${studentId}/guardians/${guardianUserId}/link`, { method: 'POST', body: JSON.stringify({ active, relationship }) }, session),
  previewStudentCsv: (session: MobileSession, csv: string) => request<{ count: number; valid: boolean; rows: Array<{ row: number; admissionNumber: string; classCode: string; classId: string | null }> }>('/admin/students/import-preview', { method: 'POST', body: JSON.stringify({ csv }) }, session),
  importStudentCsv: (session: MobileSession, csv: string) => request<{ imported: number; failed: number; results: Array<{ row: number; status: string; invitationCode?: string; error?: string }> }>('/admin/students/import', { method: 'POST', body: JSON.stringify({ csv }) }, session),
  leaveRequests: (session: MobileSession) => request<ApiLeaveRequest[]>('/admin/leave-requests', undefined, session),
  reviewLeave: (session: MobileSession, id: string, decision: 'APPROVED' | 'REJECTED', reviewNote: string) => request(`/admin/leave-requests/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, reviewNote }) }, session),
  adminCorrectionContext: (session: MobileSession, classId: string, attendanceDate: string) => request<{ roster: ApiRosterStudent[]; current: Array<{ studentId: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' }>; version: number }>(`/admin/attendance/correction-context?classId=${encodeURIComponent(classId)}&attendanceDate=${encodeURIComponent(attendanceDate)}`, undefined, session),
  adminCorrectAttendance: (session: MobileSession, payload: Record<string, unknown>) => request<{ version: number; rowCount: number }>('/admin/attendance/corrections', { method: 'POST', body: JSON.stringify(payload) }, session),
  adminSummary: (session: MobileSession, fromDate: string, toDate: string) => request<{ studentCount: number; teacherCount: number; attendance: Array<{ classId: string; status: string; count: number }>; notifications: Array<{ notificationType: string; count: number; readCount: number }>; recentAudit: Array<{ id: string; action: string; occurredAt: string }> }>(`/admin/reports/summary?fromDate=${fromDate}&toDate=${toDate}`, undefined, session),
  auditReport: (session: MobileSession) => request<Array<{ id: string; schoolId: string; actorUserId?: string; action: string; resourceType: string; occurredAt: string }>>('/admin/reports/audit', undefined, session),
  platformSummary: (session: MobileSession) => request<{ schoolCount: number; activeSchoolCount: number; schools: Array<{ schoolId: string; schoolCode: string; displayName: string; status: string; activeStudentCount: number; activeTeacherCount: number; activeParentCount: number; activeAdminCount: number }> }>('/admin/reports/platform-summary', undefined, session),
  archivePost: (session: MobileSession, postId: string, expectedRevisionNumber: number) => resilientMutation<{ status: string }>(session, `/posts/${postId}/archive`, { expectedRevisionNumber }, true),
  postReport: (session: MobileSession, postId: string) => request<{ recipientCount: number; viewedCount: number; totalViews: number; delivery: { inboxCount: number; readCount: number; deliveredCount: number; failedCount: number } }>(`/posts/${postId}/report`, undefined, session),
  attendanceCurrent: (session: MobileSession, classId: string, attendanceDate: string) => scopedRead<Array<{ id: string; studentId: string; status: string; revisionNumber: number }>>(session, `/attendance/current?classId=${classId}&attendanceDate=${attendanceDate}`),
  queuedMutations: (session: MobileSession) => queuedMutations(session.user.id),
  discardQueuedMutation: (session: MobileSession, id: string) => import('./offline').then((module) => module.removeQueuedMutation(session.user.id, id)),
  syncOfflineQueue: (session: MobileSession) => {
    const membershipId = session.activeMembershipId ?? session.memberships[0]?.id;
    const membership = session.memberships.find((item) => item.id === membershipId);
    if (!membership || !membershipId) throw new Error('ACTIVE_MEMBERSHIP_REQUIRED');
    return replayMutations({ userId: session.user.id, membershipId, schoolId: membership.schoolId }, (item) => request(item.path, { method: item.method, body: JSON.stringify(item.body) }, session));
  },
};
