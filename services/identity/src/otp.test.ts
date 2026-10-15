import { describe, expect, it } from 'vitest';
import { developmentOtpCode } from './otp';
describe('explicit trial-only mock OTP', () => {
  it('preserves the development OTP contract', () => { expect(developmentOtpCode({ NODE_ENV:'development' })).toBe('123456'); });
  it('allows the selected code only with both trial stage and explicit opt-in in production mode', () => {
    expect(developmentOtpCode({ NODE_ENV:'production', DEPLOYMENT_STAGE:'trial', ALLOW_MOCK_OTP:'true', DEVELOPMENT_OTP_CODE:'123456' })).toBe('123456');
  });
  it.each([
    { DEPLOYMENT_STAGE:'production', ALLOW_MOCK_OTP:'true' },
    { DEPLOYMENT_STAGE:'trial', ALLOW_MOCK_OTP:'false' },
    { DEPLOYMENT_STAGE:'trial' },
    { ALLOW_MOCK_OTP:'true' },
  ])('never silently bypasses production protection: %j', (flags) => {
    expect(() => developmentOtpCode({ NODE_ENV:'production', DEVELOPMENT_OTP_CODE:'123456', ...flags })).toThrow('FORBIDDEN_IN_PRODUCTION');
  });
  it('requires an explicit valid six-digit production-mode trial code', () => {
    expect(() => developmentOtpCode({ NODE_ENV:'production', DEPLOYMENT_STAGE:'trial', ALLOW_MOCK_OTP:'true' })).toThrow('DEVELOPMENT_OTP_CODE_INVALID');
  });
  it('does not pretend an unimplemented live provider is available', () => {
    expect(() => developmentOtpCode({ OTP_PROVIDER:'unconfigured-live-provider' })).toThrow('OTP_PROVIDER_UNAVAILABLE');
  });
});
