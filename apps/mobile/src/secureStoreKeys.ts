export const SESSION_SECURE_KEY = 'schoolconnect.session';

export function offlineSecretSecureKey(userId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(userId)) throw new Error('INVALID_OFFLINE_USER_ID');
  return `schoolconnect.offline-secret.${userId}`;
}
