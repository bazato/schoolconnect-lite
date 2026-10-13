import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(pbkdf2);
const iterations = 600_000;
let active = 0;
export const validPasscode = (value: unknown): value is string => typeof value === 'string' && /^\d{4}$/.test(value);
function pepper() {
  const value = process.env.PASSCODE_PEPPER ?? process.env.AUTH_JWT_SECRET;
  if (!value || value.length < 32) throw new Error('PASSCODE_PEPPER_OR_AUTH_JWT_SECRET_REQUIRED');
  return value;
}
async function digest(passcode: string, salt: string) {
  // Bounded CPU work; pepper prevents enumerating the 10,000 PINs from a DB-only leak.
  if (active >= 4) throw new Error('PASSCODE_SERVICE_BUSY');
  active++;
  try {
    const input = createHmac('sha256', pepper()).update(passcode).digest();
    return await derive(input, salt, iterations, 32, 'sha256');
  } finally { active--; }
}
export async function hashPasscode(passcode: string) {
  if (!validPasscode(passcode)) throw new Error('PASSCODE_MUST_BE_FOUR_DIGITS');
  const salt = randomBytes(16).toString('hex');
  return `pbkdf2-sha256$${iterations}$${salt}$${(await digest(passcode, salt)).toString('hex')}`;
}
export async function matchesPasscode(passcode: string, stored: string) {
  if (!validPasscode(passcode)) return false;
  const [algorithm, count, salt, expected] = stored.split('$');
  if (algorithm !== 'pbkdf2-sha256' || count !== String(iterations) || !salt || !/^[a-f0-9]{32}$/.test(salt) || !expected || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(await digest(passcode, salt), Buffer.from(expected, 'hex'));
}
