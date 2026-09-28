import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export type AccessTokenClaims = {
  userId: string;
  membershipId: string;
  sessionId: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
};

export type IssuedAccessToken = {
  accessToken: string;
  expiresInSeconds: number;
};

export interface AuthorizationProvider {
  issueAccessToken(input: { userId: string; membershipId: string; sessionId: string }): IssuedAccessToken;
  verifyAccessToken(token: string): AccessTokenClaims;
}

export class AuthorizationConfigurationError extends Error {}
export class AccessTokenValidationError extends Error {}

type AuthorizationConfiguration = {
  issuer: string;
  audience: string;
  accessTokenTtlSeconds: number;
  jwtSecret: string;
};

const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AuthorizationConfigurationError('AUTH_ACCESS_TOKEN_TTL_SECONDS must be a positive integer.');
  return parsed;
}

function configuration(environment: NodeJS.ProcessEnv): AuthorizationConfiguration {
  const production = environment.NODE_ENV === 'production';
  const issuer = environment.AUTH_JWT_ISSUER ?? 'schoolconnect-identity-local';
  const audience = environment.AUTH_JWT_AUDIENCE ?? 'schoolconnect-mobile-local';
  const accessTokenTtlSeconds = parsePositiveInteger(environment.AUTH_ACCESS_TOKEN_TTL_SECONDS, 600);
  let jwtSecret = environment.AUTH_JWT_SECRET ?? '';

  if (!jwtSecret) {
    if (production) throw new AuthorizationConfigurationError('AUTH_JWT_SECRET is required in production.');
    jwtSecret = randomBytes(48).toString('base64url');
  }
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) throw new AuthorizationConfigurationError('AUTH_JWT_SECRET must contain at least 32 bytes.');
  if (!issuer.trim() || !audience.trim()) throw new AuthorizationConfigurationError('AUTH_JWT_ISSUER and AUTH_JWT_AUDIENCE are required.');
  if (accessTokenTtlSeconds > 3_600) throw new AuthorizationConfigurationError('AUTH_ACCESS_TOKEN_TTL_SECONDS cannot exceed one hour.');

  return { issuer, audience, accessTokenTtlSeconds, jwtSecret };
}

export class LocalJwtAuthorizationProvider implements AuthorizationProvider {
  private readonly config: AuthorizationConfiguration;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.config = configuration(environment);
  }

  issueAccessToken(input: { userId: string; membershipId: string; sessionId: string }): IssuedAccessToken {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const expiresAt = issuedAt + this.config.accessTokenTtlSeconds;
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeJson({
      iss: this.config.issuer,
      aud: this.config.audience,
      sub: input.userId,
      mid: input.membershipId,
      sid: input.sessionId,
      typ: 'access',
      iat: issuedAt,
      exp: expiresAt,
      jti: randomUUID(),
    });
    const unsignedToken = `${header}.${payload}`;
    const signature = createHmac('sha256', this.config.jwtSecret).update(unsignedToken).digest('base64url');
    return { accessToken: `${unsignedToken}.${signature}`, expiresInSeconds: this.config.accessTokenTtlSeconds };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw new AccessTokenValidationError('TOKEN_MALFORMED');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', this.config.jwtSecret).update(unsignedToken).digest();
    let suppliedSignature: Buffer;
    try { suppliedSignature = Buffer.from(encodedSignature, 'base64url'); }
    catch { throw new AccessTokenValidationError('TOKEN_SIGNATURE_INVALID'); }
    if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
      throw new AccessTokenValidationError('TOKEN_SIGNATURE_INVALID');
    }

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch { throw new AccessTokenValidationError('TOKEN_PAYLOAD_INVALID'); }

    const now = Math.floor(Date.now() / 1_000);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new AccessTokenValidationError('TOKEN_ALGORITHM_INVALID');
    if (payload.iss !== this.config.issuer || payload.aud !== this.config.audience) throw new AccessTokenValidationError('TOKEN_AUTHORITY_INVALID');
    if (payload.typ !== 'access') throw new AccessTokenValidationError('TOKEN_TYPE_INVALID');
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new AccessTokenValidationError('TOKEN_ISSUED_AT_INVALID');
    if (typeof payload.exp !== 'number' || payload.exp <= now) throw new AccessTokenValidationError('TOKEN_EXPIRED');
    if (typeof payload.sub !== 'string' || typeof payload.mid !== 'string' || typeof payload.sid !== 'string' || typeof payload.jti !== 'string') {
      throw new AccessTokenValidationError('TOKEN_CLAIMS_INVALID');
    }

    return {
      userId: payload.sub,
      membershipId: payload.mid,
      sessionId: payload.sid,
      tokenId: payload.jti,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }
}

export function createAuthorizationProvider(environment: NodeJS.ProcessEnv = process.env): AuthorizationProvider {
  const provider = environment.AUTHORIZATION_PROVIDER ?? 'local-jwt';
  if (provider === 'local-jwt') return new LocalJwtAuthorizationProvider(environment);
  throw new AuthorizationConfigurationError(`Unsupported AUTHORIZATION_PROVIDER: ${provider}`);
}
