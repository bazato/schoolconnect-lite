import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalJwtAuthorizationProvider } from './authorization';

const databaseUrl = process.env.PASSCODE_DB_TEST_URL;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Explicit opt-in, localhost only, synthetic accounts only; no real credentials are changed.
describe.skipIf(!databaseUrl)('passcode authentication against Docker PostgreSQL', () => {
  let pool: Pool;
  let repository: import('./main').IdentityRepository;
  const users: string[] = [];
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/schoolconnect_identity') throw new Error('LOCAL_IDENTITY_TEST_DATABASE_REQUIRED');
    process.env.IDENTITY_SKIP_BOOTSTRAP = 'true';
    process.env.IDENTITY_DATABASE_URL = databaseUrl;
    process.env.PASSCODE_PEPPER = 'integration-pepper-012345678901234567890';
    process.env.OTP_PROVIDER = 'development'; process.env.DEVELOPMENT_OTP_CODE = '123456';
    pool = new Pool({ connectionString: databaseUrl });
    const { IdentityRepository } = await import('./main');
    repository = new IdentityRepository(new LocalJwtAuthorizationProvider({ NODE_ENV:'test', AUTH_JWT_SECRET:'integration-jwt-012345678901234567890' }));
  }, 30_000);
  afterAll(async () => {
    if (pool) {
      for (const id of users) {
        await pool.query('DELETE FROM auth_refresh_tokens WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id=$1)', [id]);
        await pool.query('DELETE FROM auth_sessions WHERE user_id=$1', [id]);
        await pool.query('DELETE FROM otp_challenges WHERE membership_id IN (SELECT id FROM memberships WHERE user_id=$1)', [id]);
        await pool.query('DELETE FROM invitations WHERE phone_hash IN (SELECT encode(digest(phone_e164,\'sha256\'),\'hex\') FROM users WHERE id=$1)', [id]);
        await pool.query('DELETE FROM memberships WHERE user_id=$1', [id]);
        await pool.query('DELETE FROM users WHERE id=$1', [id]);
      }
      await pool.end();
    }
    if (repository) await repository.onModuleDestroy();
  });
  async function fixture() {
    const id = randomUUID(); users.push(id);
    const phone = `+99${String(BigInt('0x'+id.replaceAll('-','').slice(0,10))).padStart(12,'0')}`;
    const invitation = `PIN-TEST-${id}`;
    await pool.query('INSERT INTO users(id,phone_e164,display_name) VALUES($1,$2,\'Synthetic passcode test\')', [id,phone]);
    const membership = await pool.query(`INSERT INTO memberships(user_id,role) VALUES($1,'PLATFORM_OWNER') RETURNING id`,[id]);
    await pool.query(`INSERT INTO invitations(role,phone_hash,invitation_code_hash,expires_at) VALUES('PLATFORM_OWNER',$1,$2,now()+interval '1 hour')`,[hash(phone),hash(invitation)]);
    return { id, phone, invitation, membershipId: membership.rows[0].id as string };
  }
  async function activate(f: Awaited<ReturnType<typeof fixture>>, pin='0123') {
    const challenge = await repository.requestOtp(f.phone, f.invitation);
    const grant = await repository.verifyOtp(challenge.challengeId,'123456','test-web');
    return repository.setupPasscode(grant.setupToken,pin,'test-web');
  }
  it('requires invitation on first activation and does not issue app tokens until passcode setup', async () => {
    const f=await fixture();
    await expect(repository.requestOtp(f.phone)).rejects.toThrow();
    await expect(repository.loginPasscode(f.phone,'0123','mobile')).rejects.toThrow();
    const challenge=await repository.requestOtp(f.phone,f.invitation);
    await expect(repository.verifyOtp(challenge.challengeId,'000000','web')).rejects.toThrow();
    const grant=await repository.verifyOtp(challenge.challengeId,'123456','web');
    expect(grant).not.toHaveProperty('accessToken'); expect(grant.nextStep).toBe('SET_PASSCODE');
    await expect(repository.context(grant.setupToken)).rejects.toThrow();
    await expect(repository.setupPasscode(grant.setupToken,'123','web')).rejects.toThrow();
    const session=await repository.setupPasscode(grant.setupToken,'0123','web');
    expect((await repository.context(session.accessToken)).userId).toBe(f.id);
    const row=(await pool.query('SELECT passcode_hash FROM users WHERE id=$1',[f.id])).rows[0];
    expect(row.passcode_hash).toMatch(/^pbkdf2-sha256\$/);
    await expect(repository.verifyOtp(challenge.challengeId,'123456','web')).rejects.toThrow();
    await expect(repository.setupPasscode(grant.setupToken,'9999','web')).rejects.toThrow();
    await expect(repository.requestOtp(f.phone)).rejects.toThrow();
  });
  it('logs in from both mobile and web without invitation or OTP and includes every assigned role', async () => {
    const f=await fixture(); await activate(f);
    await pool.query(`INSERT INTO memberships(user_id,school_id,role) VALUES($1,$2,'PARENT'),($1,$2,'TEACHER')`,[f.id,randomUUID()]);
    for (const device of ['web','mobile']) {
      const session=await repository.loginPasscode(f.phone,'0123',device);
      expect(session.memberships.map((m) => m.role).sort()).toEqual(['PARENT','PLATFORM_OWNER','TEACHER']);
      expect((await repository.context(session.accessToken)).userId).toBe(f.id);
    }
  });
  it('lets already-activated OTP-only users set a passcode without re-entering an invitation', async () => {
    const f=await fixture();
    await pool.query('UPDATE invitations SET accepted_at=now(),accepted_by_user_id=$1 WHERE phone_hash=$2',[f.id,hash(f.phone)]);
    const challenge=await repository.requestOtp(f.phone);
    const grant=await repository.verifyOtp(challenge.challengeId,'123456','web');
    await repository.setupPasscode(grant.setupToken,'0000','web');
    expect((await repository.loginPasscode(f.phone,'0000','mobile')).user.id).toBe(f.id);
  });
  it('atomically allows only one concurrent setup using a grant', async () => {
    const f=await fixture(); const challenge=await repository.requestOtp(f.phone,f.invitation);
    const attempts=await Promise.allSettled([0,1].map(() => repository.verifyOtp(challenge.challengeId,'123456','web')));
    expect(attempts.filter((a) => a.status==='fulfilled')).toHaveLength(1);
    const grant=(attempts.find((a) => a.status==='fulfilled') as PromiseFulfilledResult<{setupToken:string}>).value;
    const setups=await Promise.allSettled([0,1].map(() => repository.setupPasscode(grant.setupToken,'0123','web')));
    expect(setups.filter((a) => a.status==='fulfilled')).toHaveLength(1);
  });
  it('counts concurrent wrong attempts under an account lock and refuses the correct PIN while locked', async () => {
    const f=await fixture(); await activate(f);
    const failed=await Promise.allSettled(Array.from({length:8},() => repository.loginPasscode(f.phone,'9999','mobile')));
    for (const attempt of failed) { expect(attempt.status).toBe('rejected'); if(attempt.status==='rejected') expect([401,429]).toContain(attempt.reason.getStatus?.() ?? attempt.reason.message); }
    const row=(await pool.query('SELECT passcode_failed_attempts,passcode_locked_until FROM users WHERE id=$1',[f.id])).rows[0];
    expect(row.passcode_failed_attempts).toBe(5); expect(row.passcode_locked_until).toBeInstanceOf(Date);
    await expect(repository.loginPasscode(f.phone,'0123','web')).rejects.toThrow();
    await pool.query(`UPDATE users SET passcode_locked_until=now()-interval '1 second' WHERE id=$1`,[f.id]);
    await repository.loginPasscode(f.phone,'0123','web');
    expect((await pool.query('SELECT passcode_failed_attempts FROM users WHERE id=$1',[f.id])).rows[0].passcode_failed_attempts).toBe(0);
  });
  it('resets only after OTP, revokes previous sessions and makes previous reset grants unusable', async () => {
    const f=await fixture(); const old=await activate(f);
    const challenge=await repository.requestOtp(f.phone,undefined,'RESET');
    const staleChallenge=await repository.requestOtp(f.phone,undefined,'RESET');
    const unverifiedChallenge=await repository.requestOtp(f.phone,undefined,'RESET');
    const grant=await repository.verifyOtp(challenge.challengeId,'123456','web');
    const staleGrant=await repository.verifyOtp(staleChallenge.challengeId,'123456','web');
    const updated=await repository.setupPasscode(grant.setupToken,'9876','mobile');
    await expect(repository.context(old.accessToken)).rejects.toThrow();
    await expect(repository.refresh(old.refreshToken,'test-web')).rejects.toThrow();
    await expect(repository.setupPasscode(staleGrant.setupToken,'1111','web')).rejects.toThrow();
    const lateGrant=await repository.verifyOtp(unverifiedChallenge.challengeId,'123456','web');
    await expect(repository.setupPasscode(lateGrant.setupToken,'2222','web')).rejects.toThrow();
    await expect(repository.loginPasscode(f.phone,'0123','web')).rejects.toThrow();
    expect((await repository.context(updated.accessToken)).userId).toBe(f.id);
    expect((await repository.loginPasscode(f.phone,'9876','web')).user.id).toBe(f.id);
  });
  it('rejects expired grants and revoked invitations or memberships at setup', async () => {
    for (const invalid of ['expired','invitation','membership']) {
      const f=await fixture(); const challenge=await repository.requestOtp(f.phone,f.invitation);
      const grant=await repository.verifyOtp(challenge.challengeId,'123456','web');
      if(invalid==='expired') await pool.query(`UPDATE otp_challenges SET setup_expires_at=now()-interval '1 second' WHERE id=$1`,[challenge.challengeId]);
      if(invalid==='invitation') await pool.query('UPDATE invitations SET revoked_at=now() WHERE phone_hash=$1',[hash(f.phone)]);
      if(invalid==='membership') await pool.query(`UPDATE memberships SET status='REVOKED' WHERE id=$1`,[f.membershipId]);
      await expect(repository.setupPasscode(grant.setupToken,'0123','web')).rejects.toThrow();
      expect((await pool.query('SELECT passcode_hash FROM users WHERE id=$1',[f.id])).rows[0].passcode_hash).toBeNull();
    }
  });
});
