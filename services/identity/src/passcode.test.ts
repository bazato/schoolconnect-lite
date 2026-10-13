import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPasscode, matchesPasscode, validPasscode } from './passcode';

afterEach(() => vi.unstubAllEnvs());
describe('four-digit account passcode', () => {
  it.each(['0000','1234','9876'])('accepts exactly four digits including leading zeros: %s', (pin) => expect(validPasscode(pin)).toBe(true));
  it.each(['123','12345','12a4',' 1234',1234,null])('rejects invalid passcodes: %s', (pin) => expect(validPasscode(pin)).toBe(false));
  it('uses salted slow hashes and a server pepper, never a plaintext PIN', async () => {
    vi.stubEnv('PASSCODE_PEPPER', 'test-pepper-only-012345678901234567890');
    const one = await hashPasscode('0123'); const two = await hashPasscode('0123');
    expect(one).not.toBe(two); expect(one).toMatch(/^pbkdf2-sha256\$600000\$/);
    expect(await matchesPasscode('0123',one)).toBe(true);
    expect(await matchesPasscode('0124',one)).toBe(false);
    expect(await matchesPasscode('123',one)).toBe(false);
    expect(await matchesPasscode('0123','corrupted')).toBe(false);
    vi.stubEnv('PASSCODE_PEPPER', 'different-pepper-012345678901234567890');
    expect(await matchesPasscode('0123',one)).toBe(false);
  });
});
