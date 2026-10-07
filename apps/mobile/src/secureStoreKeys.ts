export const SESSION_SECURE_KEY = 'schoolconnect.session';
const validSecureStoreKey = /^[A-Za-z0-9._-]{1,200}$/;

export function assertSecureStoreKey(key: string): string {
  if (!validSecureStoreKey.test(key)) throw new Error('INVALID_SECURE_STORE_KEY');
  return key;
}

export function offlineSecretSecureKey(userId: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(userId)) throw new Error('INVALID_OFFLINE_USER_ID');
  return assertSecureStoreKey(`schoolconnect.offline-secret.${userId}`);
}
