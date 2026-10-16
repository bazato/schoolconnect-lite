import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(environment: NodeJS.ProcessEnv) {
  const secret = environment.INVITATION_CODE_KEY ?? environment.AUTH_JWT_SECRET;
  if (!secret && environment.NODE_ENV === 'production') throw new Error('INVITATION_CODE_KEY_REQUIRED');
  if (secret && Buffer.byteLength(secret) < 32) throw new Error('INVITATION_CODE_KEY_TOO_SHORT');
  return createHash('sha256').update('nexqon/invitation-code/v1\0').update(secret ?? 'local-development-invitation-key-not-for-production').digest();
}
export function encryptInvitationCode(code: string, invitationId: string, environment = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(environment), iv);
  cipher.setAAD(Buffer.from(invitationId));
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
}
export function decryptInvitationCode(value: string | null, invitationId: string, environment = process.env): string | null {
  if (!value?.startsWith('v1:')) return null;
  try {
    const bytes = Buffer.from(value.slice(3), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(environment), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28)); decipher.setAAD(Buffer.from(invitationId));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch { return null; } // Legacy/rotated-key codes require explicit reissue, never expose ciphertext.
}
