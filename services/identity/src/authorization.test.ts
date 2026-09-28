import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccessTokenValidationError,
  AuthorizationConfigurationError,
  createAuthorizationProvider,
  LocalJwtAuthorizationProvider,
} from './authorization';

const baseEnvironment = {
  NODE_ENV: 'test',
  AUTHORIZATION_PROVIDER: 'local-jwt',
  AUTH_JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-bytes',
  AUTH_JWT_ISSUER: 'test-identity',
  AUTH_JWT_AUDIENCE: 'test-mobile',
  AUTH_ACCESS_TOKEN_TTL_SECONDS: '600',
} satisfies NodeJS.ProcessEnv;

afterEach(() => vi.useRealTimers());

describe('LocalJwtAuthorizationProvider', () => {
  it('issues and verifies a session-bound access token', () => {
    const provider = new LocalJwtAuthorizationProvider(baseEnvironment);
    const issued = provider.issueAccessToken({ userId: 'user-1', membershipId: 'membership-1', sessionId: 'session-1' });
    const claims = provider.verifyAccessToken(issued.accessToken);

    expect(issued.expiresInSeconds).toBe(600);
    expect(claims).toMatchObject({ userId: 'user-1', membershipId: 'membership-1', sessionId: 'session-1' });
    expect(issued.accessToken.startsWith('dev:')).toBe(false);
  });

  it('rejects development and tampered tokens', () => {
    const provider = new LocalJwtAuthorizationProvider(baseEnvironment);
    expect(() => provider.verifyAccessToken('dev:user-1:membership-1')).toThrow(AccessTokenValidationError);

    const issued = provider.issueAccessToken({ userId: 'user-1', membershipId: 'membership-1', sessionId: 'session-1' });
    const parts = issued.accessToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload.mid = 'membership-attacker';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(() => provider.verifyAccessToken(parts.join('.'))).toThrow('TOKEN_SIGNATURE_INVALID');
  });

  it('rejects tokens from another configured authority', () => {
    const issuer = new LocalJwtAuthorizationProvider(baseEnvironment);
    const verifier = new LocalJwtAuthorizationProvider({ ...baseEnvironment, AUTH_JWT_AUDIENCE: 'another-audience' });
    const issued = issuer.issueAccessToken({ userId: 'user-1', membershipId: 'membership-1', sessionId: 'session-1' });
    expect(() => verifier.verifyAccessToken(issued.accessToken)).toThrow('TOKEN_AUTHORITY_INVALID');
  });

  it('rejects expired access tokens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T08:00:00Z'));
    const provider = new LocalJwtAuthorizationProvider({ ...baseEnvironment, AUTH_ACCESS_TOKEN_TTL_SECONDS: '60' });
    const issued = provider.issueAccessToken({ userId: 'user-1', membershipId: 'membership-1', sessionId: 'session-1' });
    vi.setSystemTime(new Date('2026-09-26T08:01:01Z'));
    expect(() => provider.verifyAccessToken(issued.accessToken)).toThrow('TOKEN_EXPIRED');
  });
});

describe('authorization provider configuration', () => {
  it('fails closed for an unsupported provider', () => {
    expect(() => createAuthorizationProvider({ ...baseEnvironment, AUTHORIZATION_PROVIDER: 'unknown' })).toThrow(AuthorizationConfigurationError);
  });

  it('requires a configured production secret', () => {
    expect(() => createAuthorizationProvider({
      NODE_ENV: 'production',
      AUTHORIZATION_PROVIDER: 'local-jwt',
      AUTH_JWT_ISSUER: 'production-identity',
      AUTH_JWT_AUDIENCE: 'production-mobile',
    })).toThrow('AUTH_JWT_SECRET is required in production.');
  });
});
