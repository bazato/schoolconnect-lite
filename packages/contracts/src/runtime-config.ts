// Server-only validation. Never log environment values or connection strings.
export type RuntimeEnvironment = Record<string, string | undefined>;
export const serviceDatabases = {
  identity: ['IDENTITY_DATABASE_URL', 'schoolconnect_identity'],
  school: ['SCHOOL_DATABASE_URL', 'schoolconnect_school'],
  content: ['CONTENT_DATABASE_URL', 'schoolconnect_content'],
  attendance: ['ATTENDANCE_DATABASE_URL', 'schoolconnect_attendance'],
  files: ['FILE_DATABASE_URL', 'schoolconnect_files'],
  notifications: ['NOTIFICATION_DATABASE_URL', 'schoolconnect_notifications'],
  audit: ['AUDIT_DATABASE_URL', 'schoolconnect_audit'],
  'read-model': ['READ_DATABASE_URL', 'schoolconnect_read'],
  fees: ['FEES_DATABASE_URL', 'schoolconnect_fees'],
} as const;
export type RuntimeService = keyof typeof serviceDatabases | 'api' | 'authorization';
export class RuntimeConfigurationError extends Error {}
const fail = (name: string, reason: string): never => { throw new RuntimeConfigurationError(`${name}:${reason}`); };
const placeholder = (value: string) => /replace[-_ ]?with|your[-_ ]|example[-_ ]?secret|changeme|local-only|copy[-_ ]?(the[-_ ])?existing|existing[-_ ]?password/i.test(value);
function secret(env: RuntimeEnvironment, name: string) {
  const value = env[name] ?? '';
  if (value.trim() !== value || new TextEncoder().encode(value).length < 32 || placeholder(value)) fail(name, 'PROTECTED_SECRET_REQUIRED');
  return value;
}
function positive(env: RuntimeEnvironment, name: string, fallback: number, maximum: number) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) fail(name, 'POSITIVE_INTEGER_REQUIRED');
  return value;
}
export function validateDatabaseUrl(value: string | undefined, name: string) {
  let url: URL;
  try { url = new URL(value ?? ''); } catch { return fail(name, 'POSTGRES_URL_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.pathname.length <= 1) fail(name, 'POSTGRES_URL_REQUIRED');
  if (url.searchParams.get('sslmode') !== 'verify-full' || url.searchParams.has('uselibpqcompat') || url.searchParams.get('ssl') === 'false') fail(name, 'VERIFIED_DATABASE_TLS_REQUIRED');
  if (placeholder(decodeURIComponent(url.password))) fail(name, 'PROTECTED_SECRET_REQUIRED');
  return url;
}
export function resolveServiceDatabases(env: RuntimeEnvironment): RuntimeEnvironment {
  const resolved = { ...env };
  for (const [variable, database] of Object.values(serviceDatabases)) {
    if (!resolved[variable] && env.DATABASE_URL) {
      let base: URL;
      try { base = new URL(env.DATABASE_URL); } catch { return fail('DATABASE_URL', 'POSTGRES_URL_REQUIRED'); }
      base.pathname = `/${database}`;
      resolved[variable] = base.toString();
    }
  }
  return resolved;
}
export function mockOtpAllowed(env: RuntimeEnvironment) {
  if (env.NODE_ENV !== 'production') return true;
  return env.DEPLOYMENT_STAGE === 'trial' && env.ALLOW_MOCK_OTP === 'true';
}
export function configuredCorsOrigins(env: RuntimeEnvironment): string[] {
  const origins = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (env.NODE_ENV !== 'production') return origins.length ? origins : ['http://localhost:8081', 'http://127.0.0.1:8081'];
  if (!origins.length) fail('CORS_ALLOWED_ORIGINS', 'EXPLICIT_HTTPS_ORIGINS_REQUIRED');
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { return fail('CORS_ALLOWED_ORIGINS', 'EXPLICIT_HTTPS_ORIGINS_REQUIRED'); }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('CORS_ALLOWED_ORIGINS', 'EXPLICIT_HTTPS_ORIGINS_REQUIRED');
  }
  return origins;
}
export function validateManagedRuntime(env: RuntimeEnvironment, service: RuntimeService | 'all' = 'all') {
  if (env.NODE_ENV !== 'production') fail('NODE_ENV', 'PRODUCTION_REQUIRED');
  if (!['trial', 'production'].includes(env.DEPLOYMENT_STAGE ?? '')) fail('DEPLOYMENT_STAGE', 'TRIAL_OR_PRODUCTION_REQUIRED');
  if (env.RENDER_DEMO_MODE === 'true' || env.SC_DEMO_SEED === 'true' || env.IDENTITY_SKIP_BOOTSTRAP === 'true') fail('DEMO_FLAGS', 'FORBIDDEN_IN_MANAGED_RUNTIME');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || env.PGSSLMODE === 'disable') fail('TLS', 'VALIDATION_MUST_NOT_BE_DISABLED');
  const internal = secret(env, 'INTERNAL_SERVICE_TOKEN');
  const scopes = service === 'all' ? [...Object.keys(serviceDatabases), 'api', 'authorization'] : [service];
  const databaseTargets = new Set<string>();
  for (const scope of scopes) {
    if (scope in serviceDatabases) {
      const [variable, expected] = serviceDatabases[scope as keyof typeof serviceDatabases];
      const url = validateDatabaseUrl(env[variable], variable);
      if (decodeURIComponent(url.pathname.slice(1)) !== expected) fail(variable, 'SERVICE_DATABASE_SCOPE_INVALID');
      if (scope === 'content' && url.hostname.includes('-pooler')) fail(variable, 'DIRECT_CONNECTION_REQUIRED_FOR_SCHEDULE_LISTENER');
      const target = `${url.host}${url.pathname}`;
      if (databaseTargets.has(target)) fail(variable, 'SERVICE_DATABASES_MUST_BE_DISTINCT');
      databaseTargets.add(target);
    }
  }
  positive(env, 'DB_CONNECTION_TIMEOUT_MS', 3000, 60000);
  positive(env, 'DB_STATEMENT_TIMEOUT_MS', 5000, 120000);
  for (const name of ['IDENTITY_DB_POOL_MAX', 'SCHOOL_DB_POOL_MAX', 'CONTENT_DB_POOL_MAX', 'ATTENDANCE_DB_POOL_MAX', 'FILES_DB_POOL_MAX', 'NOTIFICATIONS_DB_POOL_MAX', 'AUDIT_DB_POOL_MAX', 'READ_DB_POOL_MAX', 'FEES_DB_POOL_MAX']) positive(env, name, 2, 100);
  if (scopes.includes('identity')) {
    const jwt = secret(env, 'AUTH_JWT_SECRET');
    if (jwt === internal) fail('INTERNAL_SERVICE_TOKEN', 'MUST_DIFFER_FROM_JWT_SECRET');
    // Preserve the effective existing pepper; never silently change credential hashes.
    if (env.PASSCODE_PEPPER !== undefined) secret(env, 'PASSCODE_PEPPER');
    if (env.AUTHORIZATION_PROVIDER !== 'local-jwt') fail('AUTHORIZATION_PROVIDER', 'SUPPORTED_PROVIDER_REQUIRED');
    for (const name of ['AUTH_JWT_ISSUER', 'AUTH_JWT_AUDIENCE']) if (!env[name]?.trim()) fail(name, 'EXPLICIT_VALUE_REQUIRED');
    const ttl = positive(env, 'AUTH_ACCESS_TOKEN_TTL_SECONDS', 600, 900);
    if (ttl < 300) fail('AUTH_ACCESS_TOKEN_TTL_SECONDS', 'MINIMUM_300_SECONDS');
    const provider = env.OTP_PROVIDER;
    if (provider === 'development') {
      if (!mockOtpAllowed(env)) fail('OTP_PROVIDER', 'MOCK_OTP_REQUIRES_EXPLICIT_TRIAL_OPT_IN');
      if (!/^\d{6}$/.test(env.DEVELOPMENT_OTP_CODE ?? '')) fail('DEVELOPMENT_OTP_CODE', 'EXPLICIT_SIX_DIGITS_REQUIRED');
    } else fail('OTP_PROVIDER', 'LIVE_PROVIDER_NOT_IMPLEMENTED');
    positive(env, 'PASSCODE_MAX_ATTEMPTS', 5, 10);
    positive(env, 'PASSCODE_LOCK_SECONDS', 900, 86400);
    positive(env, 'PASSCODE_LOGIN_LIMIT', 30, 1000);
    positive(env, 'OTP_TTL_SECONDS', 300, 900);
    positive(env, 'OTP_MAX_ATTEMPTS', 5, 10);
    positive(env, 'OTP_REQUEST_LIMIT', 5, 100);
    positive(env, 'OTP_REQUEST_WINDOW_SECONDS', 900, 86400);
    positive(env, 'OTP_RESEND_AFTER_SECONDS', 30, 300);
  }
  if (scopes.includes('api')) {
    configuredCorsOrigins(env);
    if (env.ENFORCE_HTTPS !== 'true') fail('ENFORCE_HTTPS', 'REQUIRED');
    if (env.RESOURCE_AUTHORIZATION_PROVIDER !== 'policy') fail('RESOURCE_AUTHORIZATION_PROVIDER', 'POLICY_REQUIRED');
    positive(env, 'API_AUTH_RATE_LIMIT', 120, 1000);
    positive(env, 'API_USER_RATE_LIMIT', 600, 10000);
    positive(env, 'API_RATE_LIMIT_WINDOW_SECONDS', 60, 3600);
    if (!['rules', 'groq', 'ollama'].includes(env.FEES_QUERY_PROVIDER ?? 'rules')) fail('FEES_QUERY_PROVIDER', 'SUPPORTED_PROVIDER_REQUIRED');
  }
  if (scopes.some((scope) => scope !== 'api' && scope !== 'authorization')) {
    if (!env.KAFKA_BROKERS?.trim() || env.KAFKA_BROKERS.split(',').some((broker) => !/^[^\s,:]+:\d+$/.test(broker.trim()))) fail('KAFKA_BROKERS', 'EXPLICIT_BROKERS_REQUIRED');
    if (env.KAFKA_SSL !== 'true') fail('KAFKA_SSL', 'TLS_REQUIRED');
    if (!['plain', 'scram-sha-256', 'scram-sha-512'].includes(env.KAFKA_SASL_MECHANISM ?? '')) fail('KAFKA_SASL_MECHANISM', 'AUTHENTICATION_REQUIRED');
    for (const name of ['KAFKA_SASL_USERNAME', 'KAFKA_SASL_PASSWORD', 'KAFKA_EVENT_TOPIC']) if (!env[name]?.trim()) fail(name, 'REQUIRED');
    if (placeholder(env.KAFKA_SASL_PASSWORD!)) fail('KAFKA_SASL_PASSWORD', 'PROTECTED_SECRET_REQUIRED');
    if (env.KAFKA_CA_CERT_BASE64) {
      let certificate = '';
      try { certificate = atob(env.KAFKA_CA_CERT_BASE64); } catch { fail('KAFKA_CA_CERT_BASE64', 'PEM_CERTIFICATE_REQUIRED'); }
      if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(certificate)) fail('KAFKA_CA_CERT_BASE64', 'PEM_CERTIFICATE_REQUIRED');
    }
    if (env.KAFKA_CREATE_TOPIC !== 'false') fail('KAFKA_CREATE_TOPIC', 'PREPROVISIONED_TOPIC_REQUIRED');
    if (env.OUTBOX_POLL_INTERVAL_MS === undefined) fail('OUTBOX_POLL_INTERVAL_MS', 'EXPLICIT_INTERVAL_REQUIRED');
    positive(env, 'OUTBOX_POLL_INTERVAL_MS', 2000, 60000);
    positive(env, 'KAFKA_HANDLER_MAX_ATTEMPTS', 3, 10);
    positive(env, 'KAFKA_HANDLER_RETRY_DELAY_MS', 1000, 5000);
  }
  if (scopes.includes('files')) {
    if (!['disabled', 's3'].includes(env.FILE_STORAGE_PROVIDER ?? '')) fail('FILE_STORAGE_PROVIDER', 'EXPLICIT_PROVIDER_REQUIRED');
    if (env.FILE_STORAGE_PROVIDER === 's3') {
      if (!env.S3_BUCKET || !env.S3_REGION) fail('S3_BUCKET', 'BUCKET_AND_REGION_REQUIRED');
      if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith('https://')) fail('S3_ENDPOINT', 'HTTPS_REQUIRED');
      if (!['clamd','clamav-http'].includes(env.FILE_SCANNER_PROVIDER ?? '')) fail('FILE_SCANNER_PROVIDER', 'REAL_SCANNER_REQUIRED');
      if(env.FILE_SCANNER_PROVIDER==='clamav-http'){
        let scannerUrl:URL;try{scannerUrl=new URL(env.FILE_SCANNER_URL??'');}catch{fail('FILE_SCANNER_URL','HTTPS_REQUIRED');}
        if(scannerUrl!.protocol!=='https:'||scannerUrl!.username||scannerUrl!.password||scannerUrl!.search||scannerUrl!.hash)fail('FILE_SCANNER_URL','HTTPS_REQUIRED');
        secret(env,'FILE_SCANNER_TOKEN');
      }else if(!['localhost','127.0.0.1','::1','clamav'].includes(env.CLAMAV_HOST??'127.0.0.1'))fail('CLAMAV_HOST','REMOTE_CLAMD_REQUIRES_AUTHENTICATED_HTTPS_GATEWAY');
      positive(env,'FILE_SIGNATURE_MAX_AGE_HOURS',72,168);
      positive(env,'FILE_SCAN_TIMEOUT_MS',40000,60000);
      for(const key of ['FILE_STORAGE_BUDGET_BYTES','FILE_SCHOOL_BUDGET_BYTES'])if(!Number.isSafeInteger(Number(env[key]))||Number(env[key])<1)fail(key,'EXPLICIT_STORAGE_BUDGET_REQUIRED');
      if(Number(env.FILE_SCHOOL_BUDGET_BYTES)>Number(env.FILE_STORAGE_BUDGET_BYTES))fail('FILE_SCHOOL_BUDGET_BYTES','EXCEEDS_GLOBAL_BUDGET');
    }
    if (env.DEPLOYMENT_STAGE === 'production' && env.FILE_STORAGE_PROVIDER === 'disabled') fail('FILE_STORAGE_PROVIDER', 'ATTACHMENTS_DISABLED_NOT_PRODUCTION_READY');
  }
  return { stage: env.DEPLOYMENT_STAGE, mockOtp: env.OTP_PROVIDER === 'development', attachmentsEnabled: env.FILE_STORAGE_PROVIDER === 's3' };
}
