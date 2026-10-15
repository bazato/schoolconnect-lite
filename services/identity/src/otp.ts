import { mockOtpAllowed, type RuntimeEnvironment } from '@schoolconnect/contracts';

export function developmentOtpCode(env: RuntimeEnvironment = process.env) {
  if ((env.OTP_PROVIDER ?? 'development') !== 'development') throw new Error('OTP_PROVIDER_UNAVAILABLE');
  if (!mockOtpAllowed(env)) throw new Error('DEVELOPMENT_OTP_PROVIDER_FORBIDDEN_IN_PRODUCTION');
  const code = env.DEVELOPMENT_OTP_CODE ?? (env.NODE_ENV === 'production' ? '' : '123456');
  if (!/^\d{6}$/.test(code)) throw new Error('DEVELOPMENT_OTP_CODE_INVALID');
  return code;
}
