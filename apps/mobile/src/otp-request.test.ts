import { describe, expect, it, vi } from 'vitest';
import { withReturningMemberFallback } from './otp-request';

describe('OTP request for returning members', () => {
  it('retries without a consumed invitation', async () => {
    const send = vi.fn(async (code: string) => {
      if (code) throw new Error('INVITATION_OR_PHONE_INVALID');
      return { challengeId: 'challenge' };
    });
    await expect(withReturningMemberFallback('PARENT-INVITE', send)).resolves.toEqual({ challengeId: 'challenge' });
    expect(send.mock.calls).toEqual([['PARENT-INVITE'], ['']]);
  });

  it('preserves other failures without retrying', async () => {
    const send = vi.fn(async () => { throw new Error('RATE_LIMITED'); });
    await expect(withReturningMemberFallback('PARENT-INVITE', send)).rejects.toThrow('RATE_LIMITED');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
