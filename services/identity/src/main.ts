import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, OnModuleDestroy, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type MembershipRole = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';

@Injectable()
class IdentityRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.IDENTITY_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_identity' });

  async health() { const result = await this.pool.query<{ now: Date }>('SELECT now() AS now'); return result.rows[0]; }

  async requestOtp(phoneE164: string, invitationCode: string) {
    const invitation = await this.pool.query<{ membership_id: string }>(
      `SELECT m.id AS membership_id
       FROM invitations i
       JOIN users u ON u.phone_e164 = $1 AND u.status = 'ACTIVE'
       JOIN memberships m ON m.user_id = u.id AND m.school_id IS NOT DISTINCT FROM i.school_id AND m.role = i.role AND m.status = 'ACTIVE'
       WHERE i.invitation_code_hash = $2
         AND (i.phone_hash IS NULL OR i.phone_hash = $3)
         AND i.expires_at > now()`,
      [phoneE164, hash(invitationCode.trim()), hash(phoneE164)],
    );
    if (!invitation.rowCount) throw new BadRequestException({ code: 'INVITATION_OR_PHONE_INVALID' });
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO otp_challenges (membership_id, phone_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '5 minutes') RETURNING id`,
      [invitation.rows[0]!.membership_id, hash(phoneE164), hash('123456')],
    );
    return result.rows[0]!.id;
  }

  async verifyOtp(challengeId: string, code: string, deviceId: string) {
    const challenge = await this.pool.query<{ id: string; membership_id: string | null; phone_hash: string; code_hash: string; expires_at: Date; consumed_at: Date | null }>(
      `SELECT id, membership_id, phone_hash, code_hash, expires_at, consumed_at FROM otp_challenges WHERE id = $1`, [challengeId],
    );
    const item = challenge.rows[0];
    if (!item || item.consumed_at || item.expires_at < new Date() || item.code_hash !== hash(code)) {
      await this.pool.query('UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1', [challengeId]);
      throw new BadRequestException({ code: 'OTP_INVALID_OR_EXPIRED' });
    }

    const account = await this.pool.query<{
      user_id: string; display_name: string; membership_id: string; school_id: string | null; role: MembershipRole;
    }>(
      `SELECT u.id AS user_id, u.display_name, m.id AS membership_id, m.school_id, m.role
       FROM users u JOIN memberships m ON m.user_id = u.id
       WHERE encode(digest(u.phone_e164, 'sha256'), 'hex') = $1 AND u.status = 'ACTIVE' AND m.status = 'ACTIVE'
       ORDER BY (m.id = $2) DESC, m.role`,
      [item.phone_hash, item.membership_id],
    );
    if (!account.rowCount) throw new NotFoundException({ code: 'INVITED_ACCOUNT_NOT_FOUND' });
    await this.pool.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [challengeId]);

    const primary = account.rows[0]!;
    const refreshToken = randomUUID();
    const tokenFamilyId = randomUUID();
    await this.pool.query(
      `INSERT INTO auth_sessions (user_id, device_id, token_family_id, refresh_token_hash, expires_at, idle_expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '30 days', now() + interval '7 days')`,
      [primary.user_id, deviceId, tokenFamilyId, hash(refreshToken)],
    );
    return {
      accessToken: `dev:${primary.user_id}:${primary.membership_id}`,
      refreshToken,
      expiresInSeconds: 600,
      user: { id: primary.user_id, displayName: primary.display_name },
      memberships: account.rows.map((row) => ({ id: row.membership_id, schoolId: row.school_id, role: row.role })),
    };
  }

  async context(accessToken: string) {
    const [, userId, membershipId] = accessToken.split(':');
    if (!userId || !membershipId || !accessToken.startsWith('dev:')) throw new BadRequestException({ code: 'TOKEN_INVALID' });
    const result = await this.pool.query<{
      user_id: string; display_name: string; membership_id: string; school_id: string | null; role: MembershipRole;
    }>(
      `SELECT u.id AS user_id, u.display_name, m.id AS membership_id, m.school_id, m.role
       FROM users u JOIN memberships m ON m.user_id = u.id
       WHERE u.id = $1 AND m.id = $2 AND u.status = 'ACTIVE' AND m.status = 'ACTIVE'`,
      [userId, membershipId],
    );
    if (!result.rowCount) throw new NotFoundException({ code: 'ACTIVE_MEMBERSHIP_NOT_FOUND' });
    const row = result.rows[0]!;
    return { userId: row.user_id, displayName: row.display_name, membershipId: row.membership_id, schoolId: row.school_id, role: row.role };
  }

  async switchMembership(userId: string, membershipId: string) {
    const result = await this.pool.query<{
      user_id: string; display_name: string; membership_id: string; school_id: string | null; role: MembershipRole;
    }>(
      `SELECT u.id AS user_id, u.display_name, m.id AS membership_id, m.school_id, m.role
       FROM users u JOIN memberships m ON m.user_id = u.id
       WHERE u.id = $1 AND m.id = $2 AND u.status = 'ACTIVE' AND m.status = 'ACTIVE'`,
      [userId, membershipId],
    );
    if (!result.rowCount) throw new NotFoundException({ code: 'ACTIVE_MEMBERSHIP_NOT_FOUND' });
    const row = result.rows[0]!;
    return {
      accessToken: `dev:${row.user_id}:${row.membership_id}`,
      activeMembership: { id: row.membership_id, schoolId: row.school_id, role: row.role },
    };
  }

  async memberships(userId: string) {
    const result = await this.pool.query<{ id: string; school_id: string | null; role: MembershipRole }>(
      `SELECT id, school_id, role FROM memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY role`,
      [userId],
    );
    return result.rows.map((row) => ({ id: row.id, schoolId: row.school_id, role: row.role }));
  }

  async provisionAccount(input: { schoolId: string; role: 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT'; phoneE164: string; displayName: string }) {
    if (!/^\+[1-9]\d{7,14}$/.test(input.phoneE164) || !input.displayName?.trim() || !input.schoolId) {
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
      const membership = await client.query<{ id: string }>(
        `INSERT INTO memberships (user_id, school_id, role)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id, school_id, role) DO UPDATE SET status='ACTIVE', updated_at=now()
         RETURNING id`,
        [userId, input.schoolId, input.role]);
      const membershipId = membership.rows[0]!.id;
      const invitationCode = `SC-${randomBytes(9).toString('base64url').toUpperCase()}`;
      const invitation = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO invitations (school_id, invitation_code_hash, phone_hash, role, expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '30 days') RETURNING id, expires_at`,
        [input.schoolId, hash(invitationCode), hash(input.phoneE164), input.role]);
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1,'identity.account-provisioned.v1',$2,$3)`,
        [eventId, membershipId, { schoolId: input.schoolId, userId, membershipId, role: input.role }]);
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
      `SELECT u.id AS "userId", u.display_name AS "displayName", m.id AS "membershipId", m.role, m.status
       FROM memberships m JOIN users u ON u.id=m.user_id
       WHERE m.school_id=$1 ${roleFilter} ORDER BY u.display_name`,
      values);
    return result.rows;
  }

  async onModuleDestroy() { await this.pool.end(); }
}

@Controller('internal/v1')
class IdentityController {
  constructor(@Inject(IdentityRepository) private readonly repository: IdentityRepository) {}

  @Get('health') async health() { return { status: 'ok', service: 'identity', database: await this.repository.health() }; }

  @Post('otp/request')
  async request(@Body() body: { phoneE164?: string; invitationCode?: string }) {
    if (!body.phoneE164 || !body.invitationCode) throw new BadRequestException({ code: 'PHONE_AND_INVITATION_REQUIRED' });
    const challengeId = await this.repository.requestOtp(body.phoneE164, body.invitationCode);
    return { challengeId, expiresInSeconds: 300, resendAfterSeconds: 30, developmentCode: '123456' };
  }

  @Post('otp/verify')
  verify(@Body() body: { challengeId?: string; code?: string; deviceId?: string }) {
    if (!body.challengeId || !body.code) throw new BadRequestException({ code: 'CHALLENGE_AND_CODE_REQUIRED' });
    return this.repository.verifyOtp(body.challengeId, body.code, body.deviceId ?? 'development-device');
  }

  @Get('sessions/:accessToken/context')
  context(@Param('accessToken') accessToken: string) { return this.repository.context(accessToken); }

  @Post('sessions/context')
  contextFromBody(@Body() body: { accessToken?: string }) {
    if (!body.accessToken) throw new BadRequestException({ code: 'ACCESS_TOKEN_REQUIRED' });
    return this.repository.context(body.accessToken);
  }

  @Post('sessions/switch-membership')
  switchMembership(@Body() body: { userId?: string; membershipId?: string }) {
    if (!body.userId || !body.membershipId) throw new BadRequestException({ code: 'USER_AND_MEMBERSHIP_REQUIRED' });
    return this.repository.switchMembership(body.userId, body.membershipId);
  }

  @Get('users/:userId/memberships')
  memberships(@Param('userId') userId: string) { return this.repository.memberships(userId); }

  @Post('provisioning/accounts')
  provisionAccount(@Body() body: { schoolId?: string; role?: 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT'; phoneE164?: string; displayName?: string }) {
    if (!body.schoolId || !body.role || !['SCHOOL_ADMIN', 'TEACHER', 'PARENT'].includes(body.role) || !body.phoneE164 || !body.displayName) throw new BadRequestException({ code: 'PROVISIONING_FIELDS_REQUIRED' });
    return this.repository.provisionAccount({ schoolId: body.schoolId, role: body.role, phoneE164: body.phoneE164, displayName: body.displayName });
  }

  @Get('schools/:schoolId/members')
  schoolMembers(@Param('schoolId') schoolId: string, @Query('role') role?: MembershipRole) { return this.repository.schoolMembers(schoolId, role); }
}

@Module({ controllers: [IdentityController], providers: [IdentityRepository] })
class IdentityModule {}

async function bootstrap() {
  const app = await NestFactory.create(IdentityModule);
  await app.listen(Number(process.env.IDENTITY_PORT ?? 3101), '127.0.0.1');
}
void bootstrap();
