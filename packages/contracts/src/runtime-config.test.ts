import { describe, expect, it } from 'vitest';
import { configuredCorsOrigins, mockOtpAllowed, resolveServiceDatabases, serviceDatabases, validateDatabaseUrl, validateManagedRuntime, type RuntimeEnvironment } from './runtime-config';
function environment(): RuntimeEnvironment {
  return resolveServiceDatabases({
    NODE_ENV: 'production', DEPLOYMENT_STAGE: 'trial', ALLOW_MOCK_OTP: 'true',
    DATABASE_URL: 'postgresql://runtime:fixture-password@database.test/root?sslmode=verify-full',
    AUTH_JWT_SECRET: 'a'.repeat(40), INTERNAL_SERVICE_TOKEN: 'b'.repeat(40),
    AUTH_JWT_ISSUER: 'existing-issuer', AUTH_JWT_AUDIENCE: 'existing-audience',
    AUTHORIZATION_PROVIDER: 'local-jwt', RESOURCE_AUTHORIZATION_PROVIDER: 'policy',
    OTP_PROVIDER: 'development', DEVELOPMENT_OTP_CODE: '123456',
    CORS_ALLOWED_ORIGINS: 'https://school.example', ENFORCE_HTTPS: 'true',
    KAFKA_BROKERS: 'broker.test:9093', KAFKA_SSL: 'true', KAFKA_SASL_MECHANISM: 'scram-sha-256',
    KAFKA_SASL_USERNAME: 'fixture-user', KAFKA_SASL_PASSWORD: 'fixture-password', KAFKA_EVENT_TOPIC: 'fixture-events',
    KAFKA_CREATE_TOPIC: 'false', OUTBOX_POLL_INTERVAL_MS: '2000', FILE_STORAGE_PROVIDER: 'disabled',
  });
}
describe('managed runtime production settings', () => {
  it('allows an explicitly opted-in production-mode trial and preserves two-second polling', () => {
    const env = environment();
    expect(validateManagedRuntime(env)).toEqual({ stage: 'trial', mockOtp: true, attachmentsEnabled: false });
    expect(env.OUTBOX_POLL_INTERVAL_MS).toBe('2000');
  });
  it('derives nine distinct databases without overwriting service-specific credentials', () => {
    const env = environment();
    const override = env.IDENTITY_DATABASE_URL!.replace('runtime:', 'identity-role:');
    const resolved = resolveServiceDatabases({ ...env, IDENTITY_DATABASE_URL: override });
    expect(resolved.IDENTITY_DATABASE_URL).toBe(override);
    expect(new Set(Object.values(serviceDatabases).map(([variable]) => new URL(resolved[variable]!).pathname)).size).toBe(9);
  });
  it.each(['ALLOW_MOCK_OTP', 'DEPLOYMENT_STAGE'])('rejects an implicit mock exception when %s is missing', (name) => {
    const env = environment(); delete env[name];
    expect(() => validateManagedRuntime(env)).toThrow();
    expect(mockOtpAllowed(env)).toBe(false);
  });
  it('never permits mocked OTP in genuine production, even with the opt-in flag', () => {
    const env = { ...environment(), DEPLOYMENT_STAGE: 'production' };
    expect(mockOtpAllowed(env)).toBe(false);
    expect(() => validateManagedRuntime(env)).toThrow('MOCK_OTP_REQUIRES_EXPLICIT_TRIAL_OPT_IN');
  });
  it.each(['development', 'test', ''])('rejects NODE_ENV=%s for managed startup', (value) => {
    expect(() => validateManagedRuntime({ ...environment(), NODE_ENV: value })).toThrow('PRODUCTION_REQUIRED');
  });
  it.each(['RENDER_DEMO_MODE', 'SC_DEMO_SEED', 'IDENTITY_SKIP_BOOTSTRAP'])('rejects %s', (key) => {
    expect(() => validateManagedRuntime({ ...environment(), [key]: 'true' })).toThrow('DEMO_FLAGS');
  });
  it.each(['disable', 'require', 'no-verify', 'prefer'])('rejects non-verifying database SSL mode %s', (mode) => {
    expect(() => validateDatabaseUrl(`postgres://fixture:fixture@db.test/db?sslmode=${mode}`, 'DATABASE_URL')).toThrow('VERIFIED_DATABASE_TLS_REQUIRED');
  });
  it('rejects wrong service databases, missing credentials and TLS bypasses without echoing secrets', () => {
    const env = environment();
    expect(() => validateManagedRuntime({ ...env, CONTENT_DATABASE_URL: env.IDENTITY_DATABASE_URL })).toThrow('SERVICE_DATABASE_SCOPE_INVALID');
    expect(() => validateManagedRuntime({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow('VALIDATION_MUST_NOT_BE_DISABLED');
    expect(() => validateDatabaseUrl('postgres://private-sensitive-password@db.test/db', 'DATABASE_URL')).toThrow('DATABASE_URL:POSTGRES_URL_REQUIRED');
    expect(() => validateManagedRuntime({ ...env, AUTH_JWT_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow('PROTECTED_SECRET_REQUIRED');
    expect(() => validateManagedRuntime({ ...env, AUTH_JWT_SECRET: 'copy-the-existing-protected-secret' })).toThrow('PROTECTED_SECRET_REQUIRED');
    expect(() => validateManagedRuntime({ ...env, INTERNAL_SERVICE_TOKEN: env.AUTH_JWT_SECRET })).toThrow('MUST_DIFFER');
  });
  it.each(['http://school.example', 'https://localhost', '*', 'https://school.example/path', 'https://school.example/'])('rejects unsafe production origin %s', (origin) => {
    expect(() => configuredCorsOrigins({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: origin })).toThrow('EXPLICIT_HTTPS_ORIGINS_REQUIRED');
  });
  it('keeps local-development origins available outside production', () => {
    expect(configuredCorsOrigins({ NODE_ENV: 'development' })).toContain('http://localhost:8081');
  });
  it.each(['KAFKA_SSL', 'KAFKA_SASL_PASSWORD', 'KAFKA_EVENT_TOPIC'])('fails closed for missing %s', (name) => {
    const env = environment(); delete env[name];
    expect(() => validateManagedRuntime(env)).toThrow();
  });
  it('rejects an unconfigured or development production scanner', () => {
    expect(() => validateManagedRuntime({ ...environment(), FILE_STORAGE_PROVIDER: 's3', S3_BUCKET: 'private', S3_REGION: 'auto', FILE_SCANNER_PROVIDER: 'development-clean' })).toThrow('REAL_SCANNER_REQUIRED');
    expect(() => validateManagedRuntime({ ...environment(), FILE_STORAGE_PROVIDER: 's3', S3_BUCKET: 'private', S3_REGION: 'auto', FILE_SCANNER_PROVIDER: 'not-implemented' })).toThrow('PRODUCTION_SCANNER_NOT_IMPLEMENTED');
  });
  it('does not generate or alter the effective existing passcode pepper', () => {
    const env = environment(); const before = { ...env };
    validateManagedRuntime(env);
    expect(env).toEqual(before); expect(env.PASSCODE_PEPPER).toBeUndefined();
  });
  it('rejects invalid rate, timeout and token lifetime settings', () => {
    expect(() => validateManagedRuntime({ ...environment(), DB_STATEMENT_TIMEOUT_MS: 'NaN' })).toThrow('POSITIVE_INTEGER_REQUIRED');
    expect(() => validateManagedRuntime({ ...environment(), AUTH_ACCESS_TOKEN_TTL_SECONDS: '3600' })).toThrow('POSITIVE_INTEGER_REQUIRED');
    expect(() => validateManagedRuntime({ ...environment(), API_AUTH_RATE_LIMIT: '0' })).toThrow('POSITIVE_INTEGER_REQUIRED');
  });
  it('rejects the transaction pooler for the persistent schedule listener', () => {
    const env = environment();
    expect(() => validateManagedRuntime({ ...env, CONTENT_DATABASE_URL: env.CONTENT_DATABASE_URL!.replace('database.test', 'database-pooler.test') })).toThrow('DIRECT_CONNECTION_REQUIRED');
  });
  it('requires an explicit publisher interval rather than accidentally using the old one-second default', () => {
    const env = environment(); delete env.OUTBOX_POLL_INTERVAL_MS;
    expect(() => validateManagedRuntime(env)).toThrow('EXPLICIT_INTERVAL_REQUIRED');
  });
  it('rejects malformed broker CA configuration without echoing certificate material', () => {
    expect(() => validateManagedRuntime({ ...environment(), KAFKA_CA_CERT_BASE64:'not-a-certificate' })).toThrow('PEM_CERTIFICATE_REQUIRED');
  });
});
