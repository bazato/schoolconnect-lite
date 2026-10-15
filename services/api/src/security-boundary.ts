// Transport validation only. Role/resource decisions remain in Authorization.
export const safeIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function validSessionPrincipal(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const principal = value as Record<string, unknown>;
  return ['userId', 'membershipId', 'sessionId'].every((key) => safeIdentifier(principal[key])) &&
    typeof principal.displayName === 'string' &&
    typeof principal.role === 'string' &&
    ['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT'].includes(principal.role) &&
    (safeIdentifier(principal.schoolId) || (principal.schoolId === null && principal.role === 'PLATFORM_OWNER'));
}

const idFields = new Set(['schoolId', 'classId', 'studentId', 'postId', 'eventId', 'fileId',
  'draftId', 'membershipId', 'userId', 'teacherMembershipId', 'leaveRequestId', 'uploadSessionId',
  'ownerId', 'targetStudentId', 'actorUserId', 'guardianUserId', 'recipientUserId', 'authorMembershipId']);
const dateFields = new Set(['attendanceDate', 'fromDate', 'toDate']);

export function invalidScopeInput(params: object, query: object, body: unknown): string | undefined {
  for (const [key, value] of Object.entries(params)) if (!safeIdentifier(value)) return key;
  for (const [key, value] of Object.entries(query)) {
    if (idFields.has(key) && !safeIdentifier(value)) return key;
    if (dateFields.has(key) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) return key;
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (idFields.has(key) && value !== undefined && value !== null && !safeIdentifier(value)) return key;
    }
  }
  return undefined;
}
