import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpException, HttpStatus, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { domainEventTypes } from '@schoolconnect/contracts';
import { AccessTokenValidationError, AuthorizationProvider, createAuthorizationProvider } from './authorization';
import { startOutboxPublisher } from '@schoolconnect/eventing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type MembershipRole = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
const positiveInteger = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
};
const otpCode = () => {
  const provider = process.env.OTP_PROVIDER ?? 'development';
  if (provider !== 'development') throw new Error(`OTP_PROVIDER_UNAVAILABLE:${provider}`);
  if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_OTP_PROVIDER_FORBIDDEN_IN_PRODUCTION');
  return process.env.DEVELOPMENT_OTP_CODE ?? '123456';
};

@Injectable()
class IdentityRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.IDENTITY_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_identity',
    max: positiveInteger('IDENTITY_DB_POOL_MAX', 10, 100),
    connectionTimeoutMillis: positiveInteger('DB_CONNECTION_TIMEOUT_MS', 3_000, 60_000),
    statement_timeout: positiveInteger('DB_STATEMENT_TIMEOUT_MS', 5_000, 120_000),
  });

  constructor(private readonly authorization: AuthorizationProvider) {}

  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  private async enforceRateLimit(scope: string, subject: string, maximum: number, windowSeconds: number) {
    const subjectHash = hash(subject);
    const result = await this.pool.query<{ attempt_count: number; blocked_until: Date | null }>(
      `INSERT INTO auth_rate_limits (scope, subject_hash, window_started_at, attempt_count)
       VALUES ($1,$2,now(),1)
       ON CONFLICT (scope, subject_hash) DO UPDATE SET
         window_started_at = CASE WHEN auth_rate_limits.window_started_at < now()-($4 * interval '1 second') THEN now() ELSE auth_rate_limits.window_started_at END,
         attempt_count = CASE WHEN auth_rate_limits.window_started_at < now()-($4 * interval '1 second') THEN 1 ELSE auth_rate_limits.attempt_count+1 END,
         blocked_until = CASE
           WHEN auth_rate_limits.window_started_at < now()-($4 * interval '1 second') THEN NULL
           WHEN auth_rate_limits.attempt_count+1 > $3 THEN now()+($4 * interval '1 second')
           ELSE auth_rate_limits.blocked_until END,
         updated_at = now()
       RETURNING attempt_count, blocked_until`,
      [scope, subjectHash, maximum, windowSeconds]);
    const state = result.rows[0]!;
    if (state.attempt_count > maximum || (state.blocked_until && state.blocked_until > new Date())) {
      throw new HttpException({ code: 'RATE_LIMITED', retryAfterSeconds: windowSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async requestOtp(phoneE164: string, invitationCode?: string) {
    const normalizedPhone = phoneE164.replace(/\s/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) throw new BadRequestException({ code: 'PHONE_INVALID' });
    await this.enforceRateLimit('OTP_REQUEST_PHONE', normalizedPhone, positiveInteger('OTP_REQUEST_LIMIT', 5, 100), positiveInteger('OTP_REQUEST_WINDOW_SECONDS', 900, 86_400));
    const phoneHash = hash(normalizedPhone);
    const account = invitationCode?.trim()
      ? await this.pool.query<{ membership_id: string; invitation_id: string | null }>(
        `SELECT m.id AS membership_id, i.id AS invitation_id
         FROM invitations i
         JOIN users u ON u.phone_e164=$1 AND u.status='ACTIVE'
         JOIN memberships m ON m.user_id=u.id AND m.school_id IS NOT DISTINCT FROM i.school_id AND m.role=i.role AND m.status='ACTIVE'
         WHERE i.invitation_code_hash=$2 AND (i.phone_hash IS NULL OR i.phone_hash=$3)
           AND i.expires_at>now() AND i.accepted_at IS NULL AND i.revoked_at IS NULL`,
        [normalizedPhone, hash(invitationCode.trim()), phoneHash])
      : await this.pool.query<{ membership_id: string; invitation_id: string | null }>(
        `SELECT m.id AS membership_id, NULL::uuid AS invitation_id
         FROM users u JOIN memberships m ON m.user_id=u.id AND m.status='ACTIVE'
         WHERE u.phone_e164=$1 AND u.status='ACTIVE'
           AND EXISTS (SELECT 1 FROM invitations i WHERE i.accepted_by_user_id=u.id AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL)
         ORDER BY m.created_at LIMIT 1`, [normalizedPhone]);
    if (!account.rowCount) throw new BadRequestException({ code: invitationCode ? 'INVITATION_OR_PHONE_INVALID' : 'ACCOUNT_NOT_ACTIVATED' });
    const code = otpCode();
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO otp_challenges (membership_id, invitation_id, phone_hash, code_hash, expires_at, max_attempts)
       VALUES ($1,$2,$3,$4,now()+($5 * interval '1 second'),$6) RETURNING id`,
      [account.rows[0]!.membership_id, account.rows[0]!.invitation_id, phoneHash, hash(code), positiveInteger('OTP_TTL_SECONDS', 300, 900), positiveInteger('OTP_MAX_ATTEMPTS', 5, 10)]);
    return { challengeId: result.rows[0]!.id, developmentCode: code };
  }

  async verifyOtp(challengeId: string, code: string, deviceId: string) {
    if (!deviceId || deviceId.length > 200) throw new BadRequestException({ code: 'DEVICE_ID_INVALID' });
    await this.enforceRateLimit('OTP_VERIFY_CHALLENGE', challengeId, positiveInteger('OTP_MAX_ATTEMPTS', 5, 10), positiveInteger('OTP_TTL_SECONDS', 300, 900));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const challenge = await client.query<{ membership_id: string | null; invitation_id: string | null; phone_hash: string; code_hash: string; expires_at: Date; consumed_at: Date | null; attempt_count: number; max_attempts: number }>(
        `SELECT membership_id, invitation_id, phone_hash, code_hash, expires_at, consumed_at, attempt_count, max_attempts
         FROM otp_challenges WHERE id=$1 FOR UPDATE`, [challengeId]);
      const item = challenge.rows[0];
      const invalid = !item || item.consumed_at || item.expires_at <= new Date() || item.attempt_count >= item.max_attempts || item.code_hash !== hash(code);
      if (invalid) {
        if (item && !item.consumed_at) await client.query(`UPDATE otp_challenges SET attempt_count=LEAST(attempt_count+1,max_attempts), consumed_at=CASE WHEN attempt_count+1>=max_attempts THEN now() ELSE consumed_at END WHERE id=$1`, [challengeId]);
        await client.query('COMMIT');
        throw new BadRequestException({ code: 'OTP_INVALID_OR_EXPIRED' });
      }
      await client.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL', [challengeId]);
      const account = await client.query<{ user_id: string; display_name: string; membership_id: string; school_id: string | null; role: MembershipRole }>(
        `SELECT u.id AS user_id, COALESCE(m.display_name_override,u.display_name) AS display_name, m.id AS membership_id, m.school_id, m.role
         FROM users u JOIN memberships m ON m.user_id=u.id
         WHERE encode(digest(u.phone_e164,'sha256'),'hex')=$1 AND u.status='ACTIVE' AND m.status='ACTIVE'
         ORDER BY (m.id=$2) DESC, m.role`, [item.phone_hash, item.membership_id]);
      if (!account.rowCount) throw new NotFoundException({ code: 'INVITED_ACCOUNT_NOT_FOUND' });
      const primary = account.rows[0]!;
      if (item.invitation_id) {
        const accepted = await client.query(`UPDATE invitations SET accepted_by_user_id=$1, accepted_at=now() WHERE id=$2 AND accepted_at IS NULL AND revoked_at IS NULL`, [primary.user_id, item.invitation_id]);
        if (!accepted.rowCount) throw new BadRequestException({ code: 'INVITATION_ALREADY_USED_OR_REVOKED' });
      }
      const refreshToken = randomBytes(32).toString('base64url');
      const tokenFamilyId = randomUUID();
      const refreshDays = positiveInteger('AUTH_REFRESH_TOKEN_TTL_DAYS', 30, 365);
      const idleDays = positiveInteger('AUTH_SESSION_IDLE_TTL_DAYS', 7, 90);
      const session = await client.query<{ id: string }>(
        `INSERT INTO auth_sessions (user_id, device_id, token_family_id, refresh_token_hash, active_membership_id, expires_at, idle_expires_at)
         VALUES ($1,$2,$3,$4,$5,now()+($6 * interval '1 day'),now()+($7 * interval '1 day')) RETURNING id`,
        [primary.user_id, deviceId, tokenFamilyId, hash(refreshToken), primary.membership_id, refreshDays, idleDays]);
      await client.query(
        `INSERT INTO auth_refresh_tokens (session_id, token_family_id, token_hash, expires_at)
         VALUES ($1,$2,$3,now()+($4 * interval '1 day'))`, [session.rows[0]!.id, tokenFamilyId, hash(refreshToken), refreshDays]);
      const issued = this.authorization.issueAccessToken({ userId: primary.user_id, membershipId: primary.membership_id, sessionId: session.rows[0]!.id });
      await client.query('COMMIT');
      return { accessToken: issued.accessToken, refreshToken, expiresInSeconds: issued.expiresInSeconds,
        user: { id: primary.user_id, displayName: primary.display_name },
        memberships: account.rows.map((row) => ({ id: row.membership_id, schoolId: row.school_id, role: row.role })) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async context(accessToken: string) {
    let claims;
    try { claims = this.authorization.verifyAccessToken(accessToken); }
    catch (error) {
      const code = error instanceof AccessTokenValidationError ? error.message : 'TOKEN_INVALID';
      throw new UnauthorizedException({ code });
    }
    const result = await this.pool.query<{
      user_id: string; display_name: string; membership_id: string; school_id: string | null; role: MembershipRole; session_id: string;
    }>(
      `SELECT u.id AS user_id, COALESCE(m.display_name_override,u.display_name) AS display_name, m.id AS membership_id, m.school_id, m.role, s.id AS session_id
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id
       WHERE s.id = $1 AND s.user_id = $2 AND m.id = $3
         AND s.revoked_at IS NULL AND s.expires_at > now() AND s.idle_expires_at > now()
         AND u.status = 'ACTIVE' AND m.status = 'ACTIVE'`,
      [claims.sessionId, claims.userId, claims.membershipId],
    );
    if (!result.rowCount) throw new UnauthorizedException({ code: 'SESSION_OR_MEMBERSHIP_INACTIVE' });
    const row = result.rows[0]!;
    return { userId: row.user_id, displayName: row.display_name, membershipId: row.membership_id, schoolId: row.school_id, role: row.role, sessionId: row.session_id };
  }

  async switchMembership(userId: string, membershipId: string, sessionId: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    const result = await client.query<{
      user_id: string; display_name: string; membership_id: string; school_id: string | null; role: MembershipRole;
    }>(
      `UPDATE auth_sessions s SET active_membership_id=m.id, idle_expires_at=LEAST(s.expires_at,now()+($4 * interval '1 day'))
       FROM users u JOIN memberships m ON m.user_id=u.id
       WHERE s.id=$1 AND s.user_id=u.id AND u.id=$2 AND m.id=$3
         AND s.revoked_at IS NULL AND s.expires_at>now() AND s.idle_expires_at>now()
         AND u.status='ACTIVE' AND m.status='ACTIVE'
       RETURNING u.id AS user_id, COALESCE(m.display_name_override,u.display_name) AS display_name, m.id AS membership_id, m.school_id, m.role`,
      [sessionId, userId, membershipId, positiveInteger('AUTH_SESSION_IDLE_TTL_DAYS', 7, 90)],
    );
    if (!result.rowCount) throw new UnauthorizedException({ code: 'SESSION_OR_MEMBERSHIP_INACTIVE' });
    const row = result.rows[0]!;
    await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
      [domainEventTypes.roleSwitched,membershipId,{ schoolId:row.school_id,actorUserId:userId,actorMembershipId:membershipId,role:row.role,correlationId }]);
    await client.query('COMMIT');
    const issued = this.authorization.issueAccessToken({ userId: row.user_id, membershipId: row.membership_id, sessionId });
    return {
      accessToken: issued.accessToken,
      expiresInSeconds: issued.expiresInSeconds,
      activeMembership: { id: row.membership_id, schoolId: row.school_id, role: row.role },
    };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async refresh(refreshToken: string, deviceId: string) {
    if (!refreshToken || refreshToken.length > 300 || !deviceId || deviceId.length > 200) throw new BadRequestException({ code: 'REFRESH_REQUEST_INVALID' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const token = await client.query<{
        id: string; session_id: string; token_family_id: string; used_at: Date | null; revoked_at: Date | null; token_expires_at: Date;
        user_id: string; session_device_id: string; session_expires_at: Date; idle_expires_at: Date; session_revoked_at: Date | null;
        membership_id: string | null; display_name: string; school_id: string | null; role: MembershipRole | null;
      }>(
        `SELECT rt.id, rt.session_id, rt.token_family_id, rt.used_at, rt.revoked_at, rt.expires_at AS token_expires_at,
                s.user_id, s.device_id AS session_device_id, s.expires_at AS session_expires_at, s.idle_expires_at, s.revoked_at AS session_revoked_at,
                s.active_membership_id AS membership_id, COALESCE(m.display_name_override,u.display_name) AS display_name, m.school_id, m.role
         FROM auth_refresh_tokens rt
         JOIN auth_sessions s ON s.id=rt.session_id
         JOIN users u ON u.id=s.user_id
         LEFT JOIN memberships m ON m.id=s.active_membership_id AND m.user_id=s.user_id
         WHERE rt.token_hash=$1 FOR UPDATE OF rt,s`, [hash(refreshToken)]);
      const row = token.rows[0];
      if (!row) throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID' });
      const reused = Boolean(row.used_at || row.revoked_at);
      const inactive = row.session_revoked_at || row.token_expires_at <= new Date() || row.session_expires_at <= new Date() || row.idle_expires_at <= new Date();
      if (reused || inactive || row.session_device_id !== deviceId || !row.membership_id || !row.role) {
        await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1', [row.session_id]);
        await client.query('UPDATE auth_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE token_family_id=$1', [row.token_family_id]);
        await client.query('COMMIT');
        throw new UnauthorizedException({ code: reused ? 'REFRESH_TOKEN_REUSE_DETECTED' : 'SESSION_EXPIRED_OR_INVALID' });
      }
      const nextRefreshToken = randomBytes(32).toString('base64url');
      const nextTokenId = randomUUID();
      const refreshDays = positiveInteger('AUTH_REFRESH_TOKEN_TTL_DAYS', 30, 365);
      const idleDays = positiveInteger('AUTH_SESSION_IDLE_TTL_DAYS', 7, 90);
      await client.query(
        `INSERT INTO auth_refresh_tokens (id, session_id, token_family_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,LEAST($5::timestamptz,now()+($6 * interval '1 day')))`,
        [nextTokenId, row.session_id, row.token_family_id, hash(nextRefreshToken), row.session_expires_at, refreshDays]);
      await client.query('UPDATE auth_refresh_tokens SET used_at=now(), replaced_by_token_id=$1 WHERE id=$2 AND used_at IS NULL', [nextTokenId, row.id]);
      await client.query(
        `UPDATE auth_sessions SET refresh_token_hash=$1, idle_expires_at=LEAST(expires_at,now()+($2 * interval '1 day')) WHERE id=$3`,
        [hash(nextRefreshToken), idleDays, row.session_id]);
      const memberships = await client.query<{ id: string; school_id: string | null; role: MembershipRole }>(
        `SELECT id, school_id, role FROM memberships WHERE user_id=$1 AND status='ACTIVE' ORDER BY role`, [row.user_id]);
      const issued = this.authorization.issueAccessToken({ userId: row.user_id, membershipId: row.membership_id, sessionId: row.session_id });
      await client.query('COMMIT');
      return { accessToken: issued.accessToken, refreshToken: nextRefreshToken, expiresInSeconds: issued.expiresInSeconds,
        user: { id: row.user_id, displayName: row.display_name },
        memberships: memberships.rows.map((membership) => ({ id: membership.id, schoolId: membership.school_id, role: membership.role })) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async logout(userId: string, sessionId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ token_family_id: string }>(
        `UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING token_family_id`, [sessionId, userId]);
      if (session.rowCount) await client.query('UPDATE auth_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE token_family_id=$1', [session.rows[0]!.token_family_id]);
      await client.query('COMMIT');
      return { revoked: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async memberships(userId: string) {
    const result = await this.pool.query<{ id: string; school_id: string | null; role: MembershipRole }>(
      `SELECT id, school_id, role FROM memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY role`,
      [userId],
    );
    return result.rows.map((row) => ({ id: row.id, schoolId: row.school_id, role: row.role }));
  }

  async provisionAccount(input: { schoolId: string | null; role: MembershipRole; phoneE164: string; displayName: string }, actorUserId?: string, correlationId?: string) {
    if (!/^\+[1-9]\d{7,14}$/.test(input.phoneE164) || !input.displayName?.trim() || ((input.role === 'PLATFORM_OWNER') !== (input.schoolId === null))) {
      throw new BadRequestException({ code: 'ACCOUNT_PROVISIONING_VALIDATION_FAILED' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let user = await client.query<{ id: string }>('SELECT id FROM users WHERE phone_e164=$1 FOR UPDATE', [input.phoneE164]);
      if (!user.rowCount) {
        user = await client.query<{ id: string }>(
          `INSERT INTO users (phone_e164, display_name) VALUES ($1,$2) RETURNING id`,
          [input.phoneE164, input.displayName.trim()]);
      }
      const userId = user.rows[0]!.id;
      const membership = await client.query<{ id: string }>(input.role === 'PLATFORM_OWNER'
        ? `INSERT INTO memberships (user_id, school_id, role, display_name_override) VALUES ($1,NULL,'PLATFORM_OWNER',$2)
           ON CONFLICT (user_id, role) WHERE role='PLATFORM_OWNER' DO UPDATE SET status='ACTIVE', display_name_override=excluded.display_name_override,updated_at=now() RETURNING id`
        : `INSERT INTO memberships (user_id, school_id, role, display_name_override)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, school_id, role) DO UPDATE SET status='ACTIVE',display_name_override=excluded.display_name_override,updated_at=now()
           RETURNING id`,
        input.role === 'PLATFORM_OWNER' ? [userId, input.displayName.trim()] : [userId, input.schoolId, input.role, input.displayName.trim()]);
      const membershipId = membership.rows[0]!.id;
      const invitationCode = `SC-${randomBytes(9).toString('base64url').toUpperCase()}`;
      const invitation = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO invitations (school_id, invitation_code_hash, phone_hash, role, expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '30 days') RETURNING id, expires_at`,
        [input.schoolId, hash(invitationCode), hash(input.phoneE164), input.role]);
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1,$2,$3,$4)`,
        [eventId, domainEventTypes.accountProvisioned, membershipId, { schoolId: input.schoolId, userId, membershipId, role: input.role, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return {
        userId,
        membershipId,
        role: input.role,
        invitationId: invitation.rows[0]!.id,
        invitationCode,
        expiresAt: invitation.rows[0]!.expires_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async schoolMembers(schoolId: string, role?: MembershipRole) {
    const values: unknown[] = [schoolId];
    const roleFilter = role ? 'AND m.role=$2' : '';
    if (role) values.push(role);
    const result = await this.pool.query(
      `SELECT u.id AS "userId", COALESCE(m.display_name_override,u.display_name) AS "displayName",u.phone_e164 AS "phoneE164", m.id AS "membershipId", m.role, m.status
       FROM memberships m JOIN users u ON u.id=m.user_id
       WHERE m.school_id=$1 ${roleFilter} ORDER BY u.display_name`,
      values);
    return result.rows;
  }

  async revokeMembership(membershipId: string, actorUserId?: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const membership = await client.query<{ user_id: string; school_id: string | null; role: MembershipRole }>(
        `UPDATE memberships SET status='REVOKED',updated_at=now() WHERE id=$1 RETURNING user_id,school_id,role`, [membershipId]);
      if (membership.rowCount) {
        const row = membership.rows[0]!;
        await client.query(`UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE school_id IS NOT DISTINCT FROM $1 AND role=$2 AND accepted_by_user_id IS NULL AND phone_hash=(SELECT encode(digest(phone_e164,'sha256'),'hex') FROM users WHERE id=$3)`, [row.school_id, row.role, row.user_id]);
        await client.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE active_membership_id=$1`, [membershipId]);
        await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
          [domainEventTypes.membershipRevoked, membershipId, { schoolId: row.school_id, userId: row.user_id, membershipId, role: row.role, actorUserId, correlationId }]);
      }
      await client.query('COMMIT');
      return { revoked: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async platformMembers() {
    const result = await this.pool.query(`SELECT u.id AS "userId",COALESCE(m.display_name_override,u.display_name) AS "displayName",u.phone_e164 AS "phoneE164",m.id AS "membershipId",m.role,m.status
      FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.role='PLATFORM_OWNER' AND m.school_id IS NULL ORDER BY u.display_name`);
    return result.rows;
  }

  async updateMember(membershipId: string, schoolId: string | null, input: { displayName?: string; phoneE164?: string; status?: 'ACTIVE' | 'REVOKED' }, actorUserId?: string, correlationId?: string) {
    if (input.displayName !== undefined && (!input.displayName.trim() || input.displayName.trim().length > 160)) throw new BadRequestException({ code: 'MEMBER_NAME_INVALID' });
    if (input.phoneE164 !== undefined && !/^\+[1-9]\d{7,14}$/.test(input.phoneE164)) throw new BadRequestException({ code: 'PHONE_INVALID' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ user_id: string; phone_e164: string }>(`SELECT m.user_id,u.phone_e164 FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.id=$1 AND m.school_id IS NOT DISTINCT FROM $2 FOR UPDATE OF m,u`, [membershipId, schoolId]);
      if (!current.rowCount) throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND' });
      const user = current.rows[0]!;
      if (input.phoneE164 && input.phoneE164 !== user.phone_e164) {
        const count = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM memberships WHERE user_id=$1 AND status='ACTIVE'`, [user.user_id]);
        if (count.rows[0]!.count > 1) throw new ConflictException({ code: 'SHARED_ACCOUNT_PHONE_CHANGE_REQUIRES_OWNER_REVIEW' });
        await client.query(`UPDATE users SET phone_e164=$2,updated_at=now() WHERE id=$1`, [user.user_id, input.phoneE164]);
        await client.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1`, [user.user_id]);
        await client.query(`UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE phone_hash=$1 AND accepted_at IS NULL`, [hash(user.phone_e164)]);
      }
      const result = await client.query(`UPDATE memberships SET display_name_override=COALESCE($3,display_name_override),status=COALESCE($4,status),updated_at=now()
        WHERE id=$1 AND school_id IS NOT DISTINCT FROM $2 RETURNING id AS "membershipId",role,status,display_name_override AS "displayName"`,
        [membershipId, schoolId, input.displayName?.trim() ?? null, input.status ?? null]);
      if (input.status === 'REVOKED') {
        await client.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE active_membership_id=$1`, [membershipId]);
        await client.query(`UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE school_id IS NOT DISTINCT FROM $1 AND phone_hash=$2 AND accepted_at IS NULL`, [schoolId, hash(input.phoneE164 ?? user.phone_e164)]);
      }
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.membershipUpdated, membershipId, { schoolId, userId: user.user_id, membershipId, role: result.rows[0].role,
          status: result.rows[0].status, changedFields: Object.keys(input).filter((key) => ['displayName', 'phoneE164', 'status'].includes(key)), actorUserId, correlationId }]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async reissueInvitation(membershipId: string, schoolId: string | null, actorUserId?: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query<{ user_id: string; school_id: string | null; role: MembershipRole; phone_e164: string }>(
        `SELECT m.user_id,m.school_id,m.role,u.phone_e164 FROM memberships m JOIN users u ON u.id=m.user_id
         WHERE m.id=$1 AND m.school_id IS NOT DISTINCT FROM $2 AND m.status='ACTIVE' FOR UPDATE OF m`, [membershipId, schoolId]);
      if (!account.rowCount) throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND' });
      const row = account.rows[0]!;
      await client.query(`UPDATE invitations SET revoked_at=now() WHERE school_id IS NOT DISTINCT FROM $1 AND role=$2 AND phone_hash=$3 AND accepted_at IS NULL AND revoked_at IS NULL`, [row.school_id, row.role, hash(row.phone_e164)]);
      const invitationCode = `SC-${randomBytes(9).toString('base64url').toUpperCase()}`;
      const invitation = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO invitations (school_id,invitation_code_hash,phone_hash,role,expires_at,created_by_user_id)
         VALUES ($1,$2,$3,$4,now()+interval '30 days',$5) RETURNING id,expires_at`,
        [row.school_id, hash(invitationCode), hash(row.phone_e164), row.role, actorUserId ?? null]);
      await client.query(`INSERT INTO outbox_events (event_type,aggregate_id,payload) VALUES ($1,$2,$3)`,
        [domainEventTypes.invitationReissued, membershipId, { schoolId: row.school_id, userId: row.user_id,
          membershipId, invitationId: invitation.rows[0]!.id, role: row.role, actorUserId, correlationId }]);
      await client.query('COMMIT');
      return { invitationId: invitation.rows[0]!.id, invitationCode, expiresAt: invitation.rows[0]!.expires_at };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async platformMembershipSummary() {
    const result = await this.pool.query(
      `SELECT school_id AS "schoolId",
              count(*) FILTER (WHERE role='TEACHER' AND status='ACTIVE')::integer AS "activeTeacherCount",
              count(*) FILTER (WHERE role='PARENT' AND status='ACTIVE')::integer AS "activeParentCount",
              count(*) FILTER (WHERE role='SCHOOL_ADMIN' AND status='ACTIVE')::integer AS "activeAdminCount"
       FROM memberships WHERE school_id IS NOT NULL GROUP BY school_id`);
    return result.rows;
  }

  async claimOutbox(limit: number) {
    const result = await this.pool.query(`UPDATE outbox_events SET attempt_count=attempt_count+1,available_at=now()+interval '30 seconds'
      WHERE id IN (SELECT id FROM outbox_events WHERE processed_at IS NULL AND available_at<=now() ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $1)
      RETURNING id,event_type AS "eventType",aggregate_id AS "aggregateId",payload,occurred_at AS "occurredAt"`, [Math.min(Math.max(limit, 1), 100)]);
    return result.rows;
  }

  async completeOutbox(eventId: string, success: boolean) {
    await this.pool.query(success ? `UPDATE outbox_events SET processed_at=now() WHERE id=$1` : `UPDATE outbox_events SET available_at=now()+interval '1 minute' WHERE id=$1 AND processed_at IS NULL`, [eventId]);
    return { completed: success };
  }

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class IdentityController {
  constructor(@Inject(IdentityRepository) private readonly repository: IdentityRepository) {}

  @Get('health') async health() { return { status: 'ok', service: 'identity', database: await this.repository.health() }; }

  @Post('otp/request')
  async request(@Body() body: { phoneE164?: string; invitationCode?: string }) {
    if (!body.phoneE164) throw new BadRequestException({ code: 'PHONE_REQUIRED' });
    const result = await this.repository.requestOtp(body.phoneE164, body.invitationCode);
    return {
      challengeId: result.challengeId,
      expiresInSeconds: positiveInteger('OTP_TTL_SECONDS', 300, 900),
      resendAfterSeconds: positiveInteger('OTP_RESEND_AFTER_SECONDS', 30, 300),
      ...((process.env.OTP_PROVIDER ?? 'development') === 'development' ? { developmentCode: result.developmentCode } : {}),
    };
  }

  @Post('otp/verify')
  verify(@Body() body: { challengeId?: string; code?: string; deviceId?: string }) {
    if (!body.challengeId || !body.code) throw new BadRequestException({ code: 'CHALLENGE_AND_CODE_REQUIRED' });
    return this.repository.verifyOtp(body.challengeId, body.code, body.deviceId ?? 'development-device');
  }

  @Post('sessions/context')
  contextFromBody(@Body() body: { accessToken?: string }) {
    if (!body.accessToken) throw new BadRequestException({ code: 'ACCESS_TOKEN_REQUIRED' });
    return this.repository.context(body.accessToken);
  }

  @Post('sessions/switch-membership')
  switchMembership(@Body() body: { userId?: string; membershipId?: string; sessionId?: string }, @Headers('x-correlation-id') correlationId?: string) {
    if (!body.userId || !body.membershipId || !body.sessionId) throw new BadRequestException({ code: 'USER_MEMBERSHIP_AND_SESSION_REQUIRED' });
    return this.repository.switchMembership(body.userId, body.membershipId, body.sessionId, correlationId);
  }

  @Post('sessions/refresh')
  refresh(@Body() body: { refreshToken?: string; deviceId?: string }) {
    if (!body.refreshToken || !body.deviceId) throw new BadRequestException({ code: 'REFRESH_TOKEN_AND_DEVICE_REQUIRED' });
    return this.repository.refresh(body.refreshToken, body.deviceId);
  }

  @Post('sessions/logout')
  logout(@Body() body: { userId?: string; sessionId?: string }) {
    if (!body.userId || !body.sessionId) throw new BadRequestException({ code: 'USER_AND_SESSION_REQUIRED' });
    return this.repository.logout(body.userId, body.sessionId);
  }

  @Get('users/:userId/memberships')
  memberships(@Param('userId') userId: string) { return this.repository.memberships(userId); }

  @Post('provisioning/accounts')
  provisionAccount(@Body() body: { schoolId?: string | null; role?: MembershipRole; phoneE164?: string; displayName?: string }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) {
    if (!body.role || !['PLATFORM_OWNER','SCHOOL_ADMIN', 'TEACHER', 'PARENT'].includes(body.role) || !body.phoneE164 || !body.displayName || (body.role !== 'PLATFORM_OWNER' && !body.schoolId)) throw new BadRequestException({ code: 'PROVISIONING_FIELDS_REQUIRED' });
    return this.repository.provisionAccount({ schoolId: body.schoolId ?? null, role: body.role, phoneE164: body.phoneE164, displayName: body.displayName }, actorUserId, correlationId);
  }

  @Post('provisioning/accounts/:membershipId/revoke')
  revoke(@Param('membershipId') membershipId: string, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.revokeMembership(membershipId, actorUserId, correlationId); }

  @Post('provisioning/accounts/:membershipId/reissue-invitation')
  reissue(@Param('membershipId') membershipId: string, @Body() body: { schoolId?: string | null; actorUserId?: string }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) {
    if (body.schoolId === undefined) throw new BadRequestException({ code: 'SCHOOL_CONTEXT_REQUIRED' });
    return this.repository.reissueInvitation(membershipId, body.schoolId, actorUserId ?? body.actorUserId, correlationId);
  }

  @Get('schools/:schoolId/members')
  schoolMembers(@Param('schoolId') schoolId: string, @Query('role') role?: MembershipRole) { return this.repository.schoolMembers(schoolId, role); }
  @Get('platform/members') platformMembers() { return this.repository.platformMembers(); }
  @Get('reports/platform-memberships') platformMembershipSummary() { return this.repository.platformMembershipSummary(); }
  @Patch('members/:membershipId') updateMember(@Param('membershipId') membershipId: string, @Body() body: { schoolId: string | null; displayName?: string; phoneE164?: string; status?: 'ACTIVE' | 'REVOKED' }, @Headers('x-schoolconnect-user-id') actorUserId?: string, @Headers('x-correlation-id') correlationId?: string) { return this.repository.updateMember(membershipId, body.schoolId, body, actorUserId, correlationId); }
  @Get('outbox') outbox(@Query('limit') limit = '25') { return this.repository.claimOutbox(Number(limit)); }
  @Post('outbox/:eventId/complete') completeOutbox(@Param('eventId') eventId: string, @Body() body: { success?: boolean }) { return this.repository.completeOutbox(eventId, body.success !== false); }
}

@Module({
  controllers: [IdentityController],
  providers: [
    { provide: 'AUTHORIZATION_PROVIDER', useFactory: () => createAuthorizationProvider() },
    { provide: IdentityRepository, useFactory: (authorization: AuthorizationProvider) => new IdentityRepository(authorization), inject: ['AUTHORIZATION_PROVIDER'] },
  ],
})
class IdentityModule {}

async function bootstrap() {
  const app = await NestFactory.create(IdentityModule);
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (process.env.NODE_ENV === 'production' && (!internalToken || internalToken.length < 32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED');
  if (internalToken) app.use((request: { headers: Record<string, string | string[] | undefined> }, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => request.headers['x-internal-service-token'] === internalToken ? next() : response.status(401).json({ code: 'INTERNAL_AUTHENTICATION_REQUIRED' }));
  await app.listen(Number(process.env.IDENTITY_PORT ?? 3101), process.env.SERVICE_BIND_HOST ?? '127.0.0.1');
  await startOutboxPublisher('identity', app.get(IdentityRepository));
}
void bootstrap();
