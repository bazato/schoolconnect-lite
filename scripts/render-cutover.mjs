// Compatibility bridge for the existing Render Docker command. No DDL or seeds.
// SC_RUNTIME_MODE=managed explicitly selects the reviewed managed trial profile.
export function managedCutoverEnvironment(input) {
  const env = { ...input, NODE_ENV:'production', RENDER_DEMO_MODE:'false', SC_DEMO_SEED:'false' };
  for (const name of ['DATABASE_URL','IDENTITY_DATABASE_URL','SCHOOL_DATABASE_URL','CONTENT_DATABASE_URL','ATTENDANCE_DATABASE_URL','FILE_DATABASE_URL','NOTIFICATION_DATABASE_URL','AUDIT_DATABASE_URL','READ_DATABASE_URL','FEES_DATABASE_URL']) {
    if (!env[name]) continue;
    const url = new URL(env[name]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('MANAGED_POSTGRES_URL_REQUIRED');
    if (url.searchParams.get('ssl') === 'false' || url.searchParams.has('uselibpqcompat')) throw new Error('MANAGED_DATABASE_TLS_OVERRIDE_FORBIDDEN');
    url.searchParams.set('sslmode','verify-full');
    env[name] = url.toString();
  }
  // These are the same legacy Identity defaults: preserve active token semantics.
  // Explicit existing issuer/audience, secrets and pepper are NEVER overwritten.
  env.AUTH_JWT_ISSUER ??= 'schoolconnect-identity-local';
  env.AUTH_JWT_AUDIENCE ??= 'schoolconnect-mobile-local';
  return env;
}
