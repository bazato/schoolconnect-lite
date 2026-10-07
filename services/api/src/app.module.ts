import {
  BadGatewayException, BadRequestException, Body, CanActivate, ConflictException, Controller, createParamDecorator,
  ExecutionContext, ForbiddenException, Get, HttpException, Inject, Injectable, Module, NotFoundException, Param, Patch, Post, Query, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { parseStudentCsv } from './csv';
import { parseResultImportRows } from './results-import';
import { currentRequestContext } from './request-context';

type Role = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
type Principal = { userId: string; displayName: string; membershipId: string; schoolId: string | null; role: Role; sessionId: string };
type ScopedRequest = Request & { principal?: Principal };
type ServiceName = 'identity' | 'school' | 'content' | 'attendance' | 'files' | 'notifications' | 'audit' | 'authorization' | 'read';

const IS_PUBLIC = 'schoolconnect:is-public';
const Public = () => SetMetadata(IS_PUBLIC, true);
const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<ScopedRequest>().principal);
const configuredNumber = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
};

@Injectable()
class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const now = Date.now();
    const windowMs = configuredNumber('API_RATE_LIMIT_WINDOW_SECONDS', 60, 3600) * 1000;
    const path = request.path ?? request.url;
    const isAuthentication = path.includes('/auth/otp/');
    const limit = isAuthentication
      ? configuredNumber('API_AUTH_RATE_LIMIT', 120, 1000)
      : configuredNumber('API_USER_RATE_LIMIT', 600, 10000);
    const subject = request.principal?.userId ?? request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const key = `${subject}:${isAuthentication ? 'auth' : 'api'}`;
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) this.buckets.set(key, { count: 1, resetAt: now + windowMs });
    else {
      current.count += 1;
      if (current.count > limit) throw new HttpException({ code: 'RATE_LIMITED', retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) }, 429);
    }
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
    }
    return true;
  }
}

@Injectable()
export class ServiceClient {
  private readonly urls: Record<ServiceName, string> = {
    identity: process.env.IDENTITY_SERVICE_URL ?? 'http://127.0.0.1:3101',
    school: process.env.SCHOOL_SERVICE_URL ?? 'http://127.0.0.1:3102',
    content: process.env.CONTENT_SERVICE_URL ?? 'http://127.0.0.1:3103',
    attendance: process.env.ATTENDANCE_SERVICE_URL ?? 'http://127.0.0.1:3104',
    files: process.env.FILE_SERVICE_URL ?? 'http://127.0.0.1:3105',
    notifications: process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:3106',
    audit: process.env.AUDIT_SERVICE_URL ?? 'http://127.0.0.1:3107',
    authorization: process.env.AUTHORIZATION_SERVICE_URL ?? 'http://127.0.0.1:3108',
    read: process.env.READ_SERVICE_URL ?? 'http://127.0.0.1:3109',
  };

  async request<T>(service: ServiceName, path: string, init?: RequestInit): Promise<T> {
    try {
      const trace = currentRequestContext();
      const response = await fetch(`${this.urls[service]}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...init?.headers,
          'x-correlation-id': trace?.correlationId ?? randomUUID(),
          ...(trace?.schoolId ? { 'x-schoolconnect-school-id': trace.schoolId } : {}),
          ...(trace?.userId ? { 'x-schoolconnect-user-id': trace.userId } : {}),
          ...(trace?.membershipId ? { 'x-schoolconnect-membership-id': trace.membershipId } : {}),
          ...(trace?.role ? { 'x-schoolconnect-role': trace.role } : {}),
          ...(process.env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN } : {}),
        },
        signal: AbortSignal.timeout(5_000),
      });
      const payload = await response.json().catch(() => ({ code: 'INVALID_SERVICE_RESPONSE' })) as T & { message?: unknown };
      if (!response.ok) {
        const message = typeof payload.message === 'object' ? payload.message : payload;
        if (response.status === 400) throw new BadRequestException(message);
        if (response.status === 401) throw new UnauthorizedException(message);
        if (response.status === 403) throw new ForbiddenException(message);
        if (response.status === 404) throw new NotFoundException(message);
        if (response.status === 409) throw new ConflictException(message);
        if (response.status === 429) throw new HttpException(message ?? { code: 'RATE_LIMITED' }, 429);
        throw new BadGatewayException({ code: 'DOWNSTREAM_REJECTED', service, status: response.status, details: message });
      }
      return payload;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException({ code: 'SERVICE_UNAVAILABLE', service });
    }
  }
}

@Injectable()
class SessionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(ServiceClient) private readonly clients: ServiceClient) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED' });
    request.principal = await this.clients.request<Principal>('identity', '/internal/v1/sessions/context', {
      method: 'POST', body: JSON.stringify({ accessToken: authorization.slice(7) }),
    });
    const trace = currentRequestContext();
    if (trace) Object.assign(trace, { schoolId: request.principal.schoolId ?? undefined,
      userId: request.principal.userId, membershipId: request.principal.membershipId, role: request.principal.role });
    if (request.principal.schoolId) {
      const school = await this.clients.request<{ active: boolean }>('school', `/internal/v1/schools/${request.principal.schoolId}`);
      if (!school.active) throw new ForbiddenException({ code: 'SCHOOL_INACTIVE' });
    }
    return true;
  }
}

@Injectable()
class RoutePolicyGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(ServiceClient) private readonly clients: ServiceClient) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    if (!request.principal) throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED' });
    const decision = await this.clients.request<{ allowed: boolean; reason: string }>('authorization', '/internal/v1/decisions/route', {
      method: 'POST', body: JSON.stringify({ method: request.method, path: request.path, principal: request.principal }),
    });
    if (!decision.allowed) throw new ForbiddenException({ code: 'ROUTE_ACCESS_DENIED', reason: decision.reason });
    return true;
  }
}

type TeachingCapability = 'RESULTS' | 'ANNOUNCEMENTS' | 'ATTENDANCE';
type ResourceAuthorization = {
  teacher(principal: Principal, classId: string, capability: TeachingCapability): Promise<void>;
  guardian(principal: Principal, studentId: string): Promise<void>;
};

// Keep resource-policy decisions behind one replaceable gateway adapter. Identity
// remains the authority for sessions; School currently owns live relationships.
class SchoolResourceAuthorization implements ResourceAuthorization {
  constructor(private readonly clients: ServiceClient) {}

  async teacher(principal: Principal, classId: string, capability: TeachingCapability) {
    if (principal.role !== 'TEACHER' || !principal.schoolId || !classId) {
      throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    }
    const result = await this.clients.request<{ allowed: boolean }>('school',
      `/internal/v1/authorization/teacher?schoolId=${encodeURIComponent(principal.schoolId)}&membershipId=${encodeURIComponent(principal.membershipId)}&classId=${encodeURIComponent(classId)}&capability=${capability}`);
    if (!result.allowed) throw new ForbiddenException({ code: 'TEACHER_ASSIGNMENT_ACCESS_DENIED' });
  }

  async guardian(principal: Principal, studentId: string) {
    if (principal.role !== 'PARENT' || !principal.schoolId || !studentId) {
      throw new ForbiddenException({ code: 'PARENT_CHILD_CONTEXT_REQUIRED' });
    }
    const result = await this.clients.request<{ allowed: boolean }>('school',
      `/internal/v1/authorization/guardian?schoolId=${encodeURIComponent(principal.schoolId)}&guardianUserId=${encodeURIComponent(principal.userId)}&studentId=${encodeURIComponent(studentId)}`);
    if (!result.allowed) throw new ForbiddenException({ code: 'GUARDIAN_CHILD_ACCESS_DENIED' });
  }
}

class PolicyServiceAuthorization implements ResourceAuthorization {
  constructor(private readonly clients: ServiceClient) {}
  private async decide(action: 'TEACHER_CLASS' | 'GUARDIAN_CHILD', principal: Principal, context: Record<string, unknown>) {
    const decision = await this.clients.request<{ allowed: boolean; reason: string }>('authorization', '/internal/v1/decisions', {
      method: 'POST', body: JSON.stringify({ action, principal, ...context }),
    });
    if (!decision.allowed) throw new ForbiddenException({ code: 'RESOURCE_ACCESS_DENIED', reason: decision.reason });
  }
  teacher(principal: Principal, classId: string, capability: TeachingCapability) { return this.decide('TEACHER_CLASS', principal, { classId, capability }); }
  guardian(principal: Principal, studentId: string) { return this.decide('GUARDIAN_CHILD', principal, { studentId }); }
}

const resourceAuthorizationProvider = {
  provide: 'RESOURCE_AUTHORIZATION',
  inject: [ServiceClient],
  useFactory: (clients: ServiceClient): ResourceAuthorization => {
    const provider = process.env.RESOURCE_AUTHORIZATION_PROVIDER ?? 'policy';
    if (provider === 'policy') return new PolicyServiceAuthorization(clients);
    if (provider === 'school') return new SchoolResourceAuthorization(clients);
    throw new Error(`RESOURCE_AUTHORIZATION_PROVIDER_UNAVAILABLE:${provider}`);
  },
};

@Controller('health')
class HealthController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Public() @Get()
  async health() {
    const services = await Promise.all((['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit', 'authorization', 'read'] as ServiceName[])
      .map(async (service) => {
        try { await this.clients.request(service, '/internal/v1/health'); return { service, status: 'ok' }; }
        catch { return { service, status: 'unavailable' }; }
      }));
    return { status: services.every((item) => item.status === 'ok') ? 'ok' : 'degraded', architecture: 'microservices', services };
  }
  @Public() @Get('ready')
  async ready() {
    const result = await this.health();
    if (result.status !== 'ok') throw new HttpException(result, 503);
    return result;
  }
}

@Controller('auth')
class AuthController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Public() @Post('otp/request') request(@Body() body: { phoneE164: string; invitationCode?: string }) {
    return this.clients.request('identity', '/internal/v1/otp/request', { method: 'POST', body: JSON.stringify(body) });
  }
  @Public() @Post('otp/verify') verify(@Body() body: { challengeId: string; code: string; deviceId?: string }) {
    return this.clients.request('identity', '/internal/v1/otp/verify', { method: 'POST', body: JSON.stringify(body) });
  }
  @Public() @Post('refresh') refresh(@Body() body: { refreshToken?: string; deviceId?: string }) {
    if (!body.refreshToken || !body.deviceId) throw new BadRequestException({ code: 'REFRESH_TOKEN_AND_DEVICE_REQUIRED' });
    return this.clients.request('identity', '/internal/v1/sessions/refresh', { method: 'POST', body: JSON.stringify(body) });
  }
  @Post('switch-role')
  async switchRole(@Body() body: { membershipId?: string }, @CurrentPrincipal() principal: Principal) {
    if (!body.membershipId) throw new BadRequestException({ code: 'MEMBERSHIP_REQUIRED' });
    const result = await this.clients.request<{ accessToken: string; expiresInSeconds: number; activeMembership: { id: string; schoolId: string | null; role: Role } }>('identity', '/internal/v1/sessions/switch-membership', {
      method: 'POST', body: JSON.stringify({ userId: principal.userId, membershipId: body.membershipId, sessionId: principal.sessionId }),
    });
    return result;
  }
  @Post('logout') logout(@CurrentPrincipal() principal: Principal) {
    return this.clients.request('identity', '/internal/v1/sessions/logout', {
      method: 'POST', body: JSON.stringify({ userId: principal.userId, sessionId: principal.sessionId }),
    });
  }
}

@Controller('me')
class MeController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Get('context') async context(@CurrentPrincipal() principal: Principal) {
    const [school, memberships] = await Promise.all([
      principal.schoolId ? this.clients.request('school', `/internal/v1/schools/${principal.schoolId}`) : Promise.resolve(null),
      this.clients.request('identity', `/internal/v1/users/${principal.userId}/memberships`),
    ]);
    return { principal, school, memberships };
  }
  @Get('teaching-scope') scope(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${principal.schoolId}/teachers/${principal.membershipId}/scope`);
  }
  @Get('children') children(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${principal.schoolId}/guardians/${principal.userId}/children`);
  }
}

// Read-only, role-shaped payloads for the single mobile application. Every
// downstream identifier comes from the authenticated principal, and parent
// student access is checked before any child data is fetched.
@Controller('bff')
class MobileBffController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient,
    @Inject('RESOURCE_AUTHORIZATION') private readonly authorization: ResourceAuthorization) {}

  @Get('parent/home')
  async parentHome(@Query('studentId') studentId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT' || !principal.schoolId) throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    if (!studentId) throw new BadRequestException({ code: 'STUDENT_CONTEXT_REQUIRED' });
    await this.authorization.guardian(principal, studentId);
    const [children, timeline, attendance, notifications] = await Promise.all([
      this.clients.request('school', `/internal/v1/schools/${principal.schoolId}/guardians/${principal.userId}/children`),
      this.clients.request('read', `/internal/v1/timeline?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${encodeURIComponent(studentId)}&limit=50`),
      this.clients.request('attendance', `/internal/v1/students/${encodeURIComponent(studentId)}/attendance?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}`),
      this.clients.request('notifications', `/internal/v1/notifications?schoolId=${principal.schoolId}&recipientUserId=${principal.userId}&limit=50`),
    ]);
    return { studentId, children, timeline, attendance, notifications };
  }

  @Get('teacher/home')
  async teacherHome(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !principal.schoolId) throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    const [teachingScope, posts, drafts, notifications] = await Promise.all([
      this.clients.request('school', `/internal/v1/schools/${principal.schoolId}/teachers/${principal.membershipId}/scope`),
      this.clients.request('read', `/internal/v1/teacher-posts?schoolId=${principal.schoolId}&authorMembershipId=${principal.membershipId}&limit=50`),
      this.clients.request('content', `/internal/v1/drafts?schoolId=${principal.schoolId}&authorMembershipId=${principal.membershipId}`),
      this.clients.request('notifications', `/internal/v1/notifications?schoolId=${principal.schoolId}&recipientUserId=${principal.userId}&limit=50`),
    ]);
    return { teachingScope, posts, drafts, notifications };
  }

  @Get('admin/home')
  async adminHome(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN' || !principal.schoolId) throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const [classes, leaveRequests, notifications] = await Promise.all([
      this.clients.request('school', `/internal/v1/schools/${principal.schoolId}/classes`),
      this.clients.request('attendance', `/internal/v1/leave-requests?schoolId=${principal.schoolId}&status=PENDING`),
      this.clients.request('notifications', `/internal/v1/notifications?schoolId=${principal.schoolId}&recipientUserId=${principal.userId}&limit=50`),
    ]);
    return { classes, leaveRequests, notifications };
  }
}

@Controller('admin')
class AdminController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}

  private schoolId(principal: Principal) {
    if (!principal.schoolId) throw new ForbiddenException({ code: 'SCHOOL_CONTEXT_REQUIRED' });
    return principal.schoolId;
  }

  @Get('schools')
  schools(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    return this.clients.request('school', '/internal/v1/schools');
  }

  @Post('schools')
  async createSchool(@Body() body: { schoolCode?: string; displayName?: string; timezone?: string; adminDisplayName?: string; adminPhoneE164?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    if (!body.schoolCode || !body.displayName || !body.timezone || !body.adminDisplayName || !body.adminPhoneE164) {
      throw new BadRequestException({ code: 'SCHOOL_AND_ADMIN_FIELDS_REQUIRED' });
    }
    const school = await this.clients.request<{ id: string; schoolCode: string; displayName: string; timezone: string; status: string; created: boolean }>('school', '/internal/v1/schools', {
      method: 'POST', body: JSON.stringify({ schoolCode: body.schoolCode, displayName: body.displayName, timezone: body.timezone }),
    });
    try {
      const administrator = await this.clients.request<{ userId: string; membershipId: string; role: Role; invitationCode: string; expiresAt: string }>('identity', '/internal/v1/provisioning/accounts', {
        method: 'POST', body: JSON.stringify({ schoolId: school.id, role: 'SCHOOL_ADMIN', phoneE164: body.adminPhoneE164, displayName: body.adminDisplayName }),
      });
      return { school, administrator };
    } catch (error) {
      if (school.created) await this.clients.request('school', `/internal/v1/schools/${school.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'SUSPENDED' }) }).catch(() => undefined);
      throw error;
    }
  }

  @Patch('schools/:schoolId')
  updateSchool(@Param('schoolId') schoolId: string, @Body() body: { displayName?: string; timezone?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${schoolId}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  @Get('platform-owners')
  platformOwners(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    return this.clients.request('identity', '/internal/v1/platform/members');
  }

  @Post('platform-owners')
  createPlatformOwner(@Body() body: { displayName?: string; phoneE164?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    return this.clients.request('identity', '/internal/v1/provisioning/accounts', { method: 'POST', body: JSON.stringify({ schoolId: null, role: 'PLATFORM_OWNER', ...body }) });
  }

  @Get('schools/:schoolId/admins')
  schoolAdmins(@Param('schoolId') schoolId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    return this.clients.request('identity', `/internal/v1/schools/${schoolId}/members?role=SCHOOL_ADMIN`);
  }

  @Post('schools/:schoolId/admins')
  async addSchoolAdmin(@Param('schoolId') schoolId: string, @Body() body: { displayName?: string; phoneE164?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    const school = await this.clients.request<{ id: string; active: boolean }>('school', `/internal/v1/schools/${schoolId}`);
    if (!school.active) throw new NotFoundException({ code: 'ACTIVE_SCHOOL_NOT_FOUND' });
    return this.clients.request('identity', '/internal/v1/provisioning/accounts', { method: 'POST', body: JSON.stringify({ schoolId, role: 'SCHOOL_ADMIN', ...body }) });
  }

  @Patch('platform-owners/:membershipId')
  async updatePlatformOwner(@Param('membershipId') membershipId: string, @Body() body: { displayName?: string; phoneE164?: string; status?: 'ACTIVE' | 'REVOKED' }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    if (membershipId === principal.membershipId && body.status === 'REVOKED') throw new BadRequestException({ code: 'CANNOT_REVOKE_OWN_MEMBERSHIP' });
    const owners = await this.clients.request<Array<{ membershipId: string; status: string }>>('identity', '/internal/v1/platform/members');
    if (!owners.some((owner) => owner.membershipId === membershipId)) throw new NotFoundException({ code: 'PLATFORM_OWNER_NOT_FOUND' });
    if (body.status === 'REVOKED') {
      if (owners.filter((owner) => owner.status === 'ACTIVE').length <= 1) throw new BadRequestException({ code: 'LAST_OWNER_CANNOT_BE_REVOKED' });
    }
    return this.clients.request('identity', `/internal/v1/members/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ ...body, schoolId: null }) });
  }

  @Patch('schools/:schoolId/admins/:membershipId')
  async updateSchoolAdmin(@Param('schoolId') schoolId: string, @Param('membershipId') membershipId: string, @Body() body: { displayName?: string; phoneE164?: string; status?: 'ACTIVE' | 'REVOKED' }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    const admins = await this.clients.request<Array<{ membershipId: string }>>('identity', `/internal/v1/schools/${schoolId}/members?role=SCHOOL_ADMIN`);
    if (!admins.some((admin) => admin.membershipId === membershipId)) throw new NotFoundException({ code: 'SCHOOL_ADMIN_NOT_FOUND' });
    return this.clients.request('identity', `/internal/v1/members/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ ...body, schoolId }) });
  }

  @Post('schools/:schoolId/admins/:membershipId/reissue-invitation')
  async reissueSchoolAdmin(@Param('schoolId') schoolId: string, @Param('membershipId') membershipId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    const admins = await this.clients.request<Array<{ membershipId: string }>>('identity', `/internal/v1/schools/${schoolId}/members?role=SCHOOL_ADMIN`);
    if (!admins.some((admin) => admin.membershipId === membershipId)) throw new NotFoundException({ code: 'SCHOOL_ADMIN_NOT_FOUND' });
    return this.clients.request('identity', `/internal/v1/provisioning/accounts/${membershipId}/reissue-invitation`, { method: 'POST', body: JSON.stringify({ schoolId, actorUserId: principal.userId }) });
  }

  @Post('platform-owners/:membershipId/reissue-invitation')
  async reissuePlatformOwner(@Param('membershipId') membershipId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    const owners = await this.clients.request<Array<{ membershipId: string }>>('identity', '/internal/v1/platform/members');
    if (!owners.some((owner) => owner.membershipId === membershipId)) throw new NotFoundException({ code: 'PLATFORM_OWNER_NOT_FOUND' });
    return this.clients.request('identity', `/internal/v1/provisioning/accounts/${membershipId}/reissue-invitation`, { method: 'POST', body: JSON.stringify({ schoolId: null, actorUserId: principal.userId }) });
  }

  @Get('classes')
  classes(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/classes`);
  }

  @Post('classes')
  createClass(@Body() body: { classCode?: string; displayName?: string; academicYear?: string; gradeCode?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/classes`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }

  @Patch('configuration')
  configuration(@Body() body: { scheduledAnnouncementsEnabled?: boolean; schoolWideAnnouncementsEnabled?: boolean; gradeWideAnnouncementsEnabled?: boolean; urgentAnnouncementsEnabled?: boolean }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/configuration`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  @Post('academic-years/rollover')
  rollover(@Body() body: { fromYear?: string; toYear?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/academic-years/rollover`, { method: 'POST', body: JSON.stringify(body) });
  }

  @Get('teachers')
  teachers(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('identity', `/internal/v1/schools/${this.schoolId(principal)}/members?role=TEACHER`);
  }

  @Get('parents')
  parents(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('identity', `/internal/v1/schools/${this.schoolId(principal)}/members?role=PARENT`);
  }

  @Get('teachers/:membershipId/assignments')
  assignments(@Param('membershipId') membershipId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/teachers/${membershipId}/assignments`);
  }

  @Patch('assignments/:assignmentId')
  updateAssignment(@Param('assignmentId') assignmentId: string, @Body() body: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/teacher-assignments/${assignmentId}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  @Patch('members/:membershipId')
  async updateMember(@Param('membershipId') membershipId: string, @Body() body: { displayName?: string; phoneE164?: string; status?: 'ACTIVE' | 'REVOKED' }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const schoolId = this.schoolId(principal);
    const members = await this.clients.request<Array<{ membershipId: string; userId: string; role: Role }>>('identity', `/internal/v1/schools/${schoolId}/members`);
    const target = members.find((member) => member.membershipId === membershipId);
    if (!target || !['TEACHER','PARENT'].includes(target.role)) throw new ForbiddenException({ code: 'MEMBER_MANAGEMENT_DENIED' });
    const result = await this.clients.request('identity', `/internal/v1/members/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ ...body, schoolId }) });
    if (body.status === 'REVOKED' && target.role === 'TEACHER') await this.clients.request('school', `/internal/v1/schools/${schoolId}/teachers/${membershipId}/revoke-assignments`, { method: 'POST', body: '{}' });
    if (body.status === 'REVOKED' && target.role === 'PARENT') await this.clients.request('school', `/internal/v1/schools/${schoolId}/guardians/${target.userId}/revoke-links`, { method: 'POST', body: '{}' });
    return result;
  }

  @Post('teachers')
  async createTeacher(@Body() body: { displayName?: string; phoneE164?: string; classId?: string; subjectCode?: string; subjectName?: string; canPublishResults?: boolean; canPublishAnnouncements?: boolean; canRecordAttendance?: boolean; canPublishSchoolWide?: boolean; canPublishGradeWide?: boolean; canPublishUrgent?: boolean }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const schoolId = this.schoolId(principal);
    if (!body.displayName || !body.phoneE164 || !body.classId || !body.subjectCode || !body.subjectName) {
      throw new BadRequestException({ code: 'TEACHER_AND_ASSIGNMENT_FIELDS_REQUIRED' });
    }
    const classes = await this.clients.request<Array<{ id: string }>>('school', `/internal/v1/schools/${schoolId}/classes`);
    if (!classes.some((item) => item.id === body.classId)) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
    const teacher = await this.clients.request<{ userId: string; membershipId: string; role: Role; invitationCode: string; expiresAt: string }>('identity', '/internal/v1/provisioning/accounts', {
      method: 'POST', body: JSON.stringify({ schoolId, role: 'TEACHER', phoneE164: body.phoneE164, displayName: body.displayName }),
    });
    try {
      const assignment = await this.clients.request('school', `/internal/v1/schools/${schoolId}/teacher-assignments`, {
        method: 'POST',
        body: JSON.stringify({ teacherMembershipId: teacher.membershipId, classId: body.classId, subjectCode: body.subjectCode,
          subjectName: body.subjectName, canPublishResults: body.canPublishResults ?? false,
          canPublishAnnouncements: body.canPublishAnnouncements ?? true, canRecordAttendance: body.canRecordAttendance ?? true,
          canPublishSchoolWide: body.canPublishSchoolWide ?? false, canPublishGradeWide: body.canPublishGradeWide ?? false,canPublishUrgent: body.canPublishUrgent ?? false }),
      });
      return { teacher, assignment };
    } catch (error) {
      await this.clients.request('identity', `/internal/v1/provisioning/accounts/${teacher.membershipId}/revoke`, { method: 'POST', body: '{}' }).catch(() => undefined);
      throw error;
    }
  }

  @Get('students')
  students(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/students`);
  }

  @Patch('students/:studentId')
  updateStudent(@Param('studentId') studentId: string, @Body() body: { displayName?: string; status?: 'ACTIVE' | 'INACTIVE' | 'GRADUATED'; classId?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/students/${studentId}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  @Post('students/:studentId/guardians/:guardianUserId/link')
  async linkGuardian(@Param('studentId') studentId: string, @Param('guardianUserId') guardianUserId: string, @Body() body: { active: boolean; relationship?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const schoolId = this.schoolId(principal);
    const parents = await this.clients.request<Array<{ userId: string; status: string }>>('identity', `/internal/v1/schools/${schoolId}/members?role=PARENT`);
    if (!parents.some((parent) => parent.userId === guardianUserId && parent.status === 'ACTIVE')) throw new ForbiddenException({ code: 'PARENT_NOT_ACTIVE_IN_SCHOOL' });
    return this.clients.request('school', `/internal/v1/schools/${schoolId}/students/${studentId}/guardians/${guardianUserId}/link`, { method: 'POST', body: JSON.stringify(body) });
  }

  @Post('parents')
  async createParent(@Body() body: { displayName?: string; phoneE164?: string; studentDisplayName?: string; admissionNumber?: string; classId?: string; relationship?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const schoolId = this.schoolId(principal);
    if (!body.displayName || !body.phoneE164 || !body.studentDisplayName || !body.admissionNumber || !body.classId) throw new BadRequestException({ code: 'PARENT_AND_STUDENT_FIELDS_REQUIRED' });
    const classes = await this.clients.request<Array<{ id: string }>>('school', `/internal/v1/schools/${schoolId}/classes`);
    if (!classes.some((item) => item.id === body.classId)) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
    const parent = await this.clients.request<{ userId: string; membershipId: string; role: Role; invitationCode: string; expiresAt: string }>('identity', '/internal/v1/provisioning/accounts', {
      method: 'POST', body: JSON.stringify({ schoolId, role: 'PARENT', phoneE164: body.phoneE164, displayName: body.displayName }),
    });
    try {
      const student = await this.clients.request('school', `/internal/v1/schools/${schoolId}/students-and-guardians`, {
        method: 'POST', body: JSON.stringify({ classId: body.classId, guardianUserId: parent.userId, admissionNumber: body.admissionNumber,
          studentDisplayName: body.studentDisplayName, relationship: body.relationship ?? 'Parent' }),
      });
      return { parent, student };
    } catch (error) {
      await this.clients.request('identity', `/internal/v1/provisioning/accounts/${parent.membershipId}/revoke`, { method: 'POST', body: '{}' }).catch(() => undefined);
      throw error;
    }
  }

  @Post('members/:membershipId/reissue-invitation')
  reissueInvitation(@Param('membershipId') membershipId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('identity', `/internal/v1/provisioning/accounts/${membershipId}/reissue-invitation`, {
      method: 'POST', body: JSON.stringify({ schoolId: this.schoolId(principal), actorUserId: principal.userId }),
    });
  }

  @Post('students/import-preview')
  async previewImport(@Body() body: { csv?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const rows = parseStudentCsv(body.csv ?? '');
    const classes = await this.clients.request<Array<{ id: string; classCode: string }>>('school', `/internal/v1/schools/${this.schoolId(principal)}/classes`);
    return { count: rows.length, rows: rows.map((row, index) => ({ row: index + 2, admissionNumber: row.admissionNumber, studentDisplayName: row.studentDisplayName, classCode: row.classCode, classId: classes.find((item) => item.classCode === row.classCode)?.id ?? null })), valid: rows.every((row) => classes.some((item) => item.classCode === row.classCode)) };
  }

  @Post('students/import')
  async importStudents(@Body() body: { csv?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const schoolId = this.schoolId(principal);
    const rows = parseStudentCsv(body.csv ?? '');
    const classes = await this.clients.request<Array<{ id: string; classCode: string }>>('school', `/internal/v1/schools/${schoolId}/classes`);
    if (rows.some((row) => !classes.some((item) => item.classCode === row.classCode))) throw new BadRequestException({ code: 'CSV_CLASS_NOT_FOUND' });
    const results: Array<{ row: number; admissionNumber: string; status: 'IMPORTED' | 'FAILED'; invitationCode?: string; error?: string }> = [];
    for (const [index, row] of rows.entries()) {
      try {
        const created = await this.createParent({ displayName: row.parentDisplayName, phoneE164: row.parentPhoneE164,
          studentDisplayName: row.studentDisplayName, admissionNumber: row.admissionNumber,
          classId: classes.find((item) => item.classCode === row.classCode)!.id, relationship: row.relationship }, principal) as { parent: { invitationCode: string } };
        results.push({ row: index + 2, admissionNumber: row.admissionNumber, status: 'IMPORTED', invitationCode: created.parent.invitationCode });
      } catch (error) { results.push({ row: index + 2, admissionNumber: row.admissionNumber, status: 'FAILED', error: error instanceof Error ? error.message : 'IMPORT_FAILED' }); }
    }
    return { imported: results.filter((item) => item.status === 'IMPORTED').length, failed: results.filter((item) => item.status === 'FAILED').length, results };
  }

  private async resolveResultImport(principal: Principal, input: unknown) {
    const rows = parseResultImportRows(input);
    const schoolId = this.schoolId(principal);
    const [students, classes] = await Promise.all([
      this.clients.request<Array<{ id: string; admissionNumber: string; displayName: string; classId: string | null; className?: string; guardianCount: number; status: string }>>('school', `/internal/v1/schools/${schoolId}/students`),
      this.clients.request<Array<{ id: string; classCode: string; displayName: string; status: string }>>('school', `/internal/v1/schools/${schoolId}/classes`),
    ]);
    const studentByAdmission = new Map(students.map((student) => [student.admissionNumber.toUpperCase(), student]));
    const activeClasses = new Map(classes.filter((item) => item.status === 'ACTIVE').map((item) => [item.id, item]));
    return rows.map((row, index) => {
      const student = studentByAdmission.get(row.admissionNumber);
      const classroom = student?.classId ? activeClasses.get(student.classId) : undefined;
      const error = !student ? 'STUDENT_NOT_FOUND_IN_SCHOOL'
        : student.status !== 'ACTIVE' ? 'STUDENT_NOT_ACTIVE'
          : !classroom ? 'STUDENT_CLASS_NOT_ACTIVE'
            : student.guardianCount < 1 ? 'NO_ACTIVE_GUARDIAN' : undefined;
      return { ...row, row: index + 2, studentId: student?.id ?? null, studentName: student?.displayName ?? null,
        classId: classroom?.id ?? null, className: classroom?.displayName ?? null, guardianCount: student?.guardianCount ?? 0,
        status: error ? 'INVALID' : 'READY', error };
    });
  }

  @Post('results/import-preview')
  async previewResultImport(@Body() body: { rows?: unknown }, @CurrentPrincipal() principal: Principal) {
    const rows = await this.resolveResultImport(principal, body.rows);
    return { count: rows.length, valid: rows.every((row) => row.status === 'READY'), rows };
  }

  @Post('results/import-publish')
  async publishResultImport(@Body() body: { batchId?: string; rows?: unknown }, @CurrentPrincipal() principal: Principal) {
    if (!body.batchId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.batchId)) {
      throw new BadRequestException({ code: 'RESULT_BATCH_ID_INVALID' });
    }
    const rows = await this.resolveResultImport(principal, body.rows);
    const invalid = rows.find((row) => row.status !== 'READY');
    if (invalid) throw new BadRequestException({ code: 'RESULT_IMPORT_HAS_INVALID_ROWS', row: invalid.row, reason: invalid.error });
    const schoolId = this.schoolId(principal);
    const recipientCache = new Map<string, Array<{ studentId: string; guardianUserId: string; snapshot?: Record<string, unknown> }>>();
    for (const row of rows) {
      if (!recipientCache.has(row.classId!)) {
        const recipients = await this.clients.request<Array<{ studentId: string; guardianUserId: string; snapshot?: Record<string, unknown> }>>(
          'school', `/internal/v1/schools/${schoolId}/classes/${row.classId}/recipients`);
        recipientCache.set(row.classId!, recipients);
      }
    }
    const resultRows = rows.map((row) => ({ admissionNumber: row.admissionNumber, studentId: row.studentId!, classId: row.classId!,
      examName: row.examName, subjectCode: row.subjectCode, subjectName: row.subjectName, marksObtained: row.marksObtained,
      maxMarks: row.maxMarks, grade: row.grade, remarks: row.remarks, resultDate: row.resultDate,
      recipients: (recipientCache.get(row.classId!) ?? []).filter((recipient) => recipient.studentId === row.studentId) }));
    if (resultRows.some((row) => row.recipients.length === 0)) throw new BadRequestException({ code: 'RESULT_GUARDIAN_CHANGED_REVIEW_IMPORT' });
    return this.clients.request('content', '/internal/v1/results/bulk-publish', { method: 'POST', body: JSON.stringify({
      schoolId, actorUserId: principal.userId, authorMembershipId: principal.membershipId, idempotencyKey: body.batchId,
      correlationId: currentRequestContext()?.correlationId, rows: resultRows,
    }) });
  }

  @Get('leave-requests')
  async leaveRequests(@Query('status') status: string | undefined, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    const schoolId = this.schoolId(principal);
    const [leaves, students] = await Promise.all([
      this.clients.request<Array<{ studentId: string } & Record<string, unknown>>>('attendance', `/internal/v1/leave-requests?schoolId=${schoolId}${status ? `&status=${encodeURIComponent(status)}` : ''}`),
      this.clients.request<Array<{ id: string; displayName: string }>>('school', `/internal/v1/schools/${schoolId}/students`),
    ]);
    const names = new Map(students.map((student) => [student.id, student.displayName]));
    return leaves.map((leave) => ({ ...leave, studentName: names.get(leave.studentId) ?? 'Student' }));
  }

  @Post('leave-requests/:leaveRequestId/review')
  reviewLeave(@Param('leaveRequestId') leaveRequestId: string, @Body() body: { decision?: 'APPROVED' | 'REJECTED'; reviewNote?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('attendance', `/internal/v1/leave-requests/${leaveRequestId}/review`, { method: 'POST', body: JSON.stringify({ ...body, schoolId: this.schoolId(principal), actorMembershipId: principal.membershipId, correlationId: currentRequestContext()?.correlationId }) });
  }

  @Get('attendance/correction-context')
  async correctionContext(@Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) throw new BadRequestException({ code: 'ATTENDANCE_DATE_INVALID' });
    const schoolId = this.schoolId(principal);
    const classes = await this.clients.request<Array<{ id: string }>>('school', `/internal/v1/schools/${schoolId}/classes`);
    if (!classes.some((item) => item.id === classId)) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
    const [roster, current, version] = await Promise.all([
      this.clients.request<Array<{ id: string; displayName: string }>>('school', `/internal/v1/schools/${schoolId}/classes/${classId}/roster`),
      this.clients.request<Array<{ studentId: string; status: string }>>('attendance', `/internal/v1/attendance/current?schoolId=${schoolId}&classId=${classId}&attendanceDate=${attendanceDate}`),
      this.clients.request<{ version: number }>('attendance', `/internal/v1/attendance/version?schoolId=${schoolId}&classId=${classId}&attendanceDate=${attendanceDate}`),
    ]);
    return { roster, current, version: version.version };
  }

  @Post('attendance/corrections')
  async adminCorrection(@Body() body: { classId?: string; attendanceDate?: string; expectedVersion?: number; correctionReason?: string; idempotencyKey?: string; rows?: Array<{ studentId: string; status: string }> }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    if (!body.classId || !body.attendanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.attendanceDate) || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || !body.idempotencyKey || !body.correctionReason || body.correctionReason.trim().length < 10) {
      throw new BadRequestException({ code: 'ADMIN_CORRECTION_FIELDS_REQUIRED' });
    }
    const schoolId = this.schoolId(principal);
    const classes = await this.clients.request<Array<{ id: string }>>('school', `/internal/v1/schools/${schoolId}/classes`);
    if (!classes.some((item) => item.id === body.classId)) throw new BadRequestException({ code: 'CLASS_NOT_FOUND_IN_SCHOOL' });
    const [roster, notificationRecipients] = await Promise.all([
      this.clients.request<Array<{ id: string }>>('school', `/internal/v1/schools/${schoolId}/classes/${body.classId}/roster`),
      this.clients.request<Array<{ studentId: string; guardianUserId: string }>>('school', `/internal/v1/schools/${schoolId}/classes/${body.classId}/audience-recipients?audienceType=CLASS`),
    ]);
    const ids = new Set(roster.map((item) => item.id));
    if (!body.rows?.length || body.rows.length !== roster.length || new Set(body.rows.map((item) => item.studentId)).size !== roster.length || body.rows.some((item) => !ids.has(item.studentId))) throw new BadRequestException({ code: 'ATTENDANCE_ROSTER_MISMATCH' });
    return this.clients.request('attendance', '/internal/v1/attendance/batches', { method: 'POST', body: JSON.stringify({ ...body, correctionReason: body.correctionReason.trim(), schoolId,
      notificationRecipients: notificationRecipients.map(({ studentId, guardianUserId }) => ({ studentId, guardianUserId })),
      actorUserId: principal.userId, actorMembershipId: principal.membershipId, correlationId: currentRequestContext()?.correlationId }) });
  }

  @Get('reports/summary')
  async summary(@Query('fromDate') fromDate: string, @Query('toDate') toDate: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) throw new BadRequestException({ code: 'REPORT_DATE_RANGE_INVALID' });
    const schoolId = this.schoolId(principal);
    const [students, teachers, attendance, notifications, audit] = await Promise.all([
      this.clients.request<unknown[]>('school', `/internal/v1/schools/${schoolId}/students`),
      this.clients.request<unknown[]>('identity', `/internal/v1/schools/${schoolId}/members?role=TEACHER`),
      this.clients.request('read', `/internal/v1/attendance/summary?schoolId=${schoolId}&fromDate=${fromDate}&toDate=${toDate}`),
      this.clients.request('notifications', `/internal/v1/notifications/summary?schoolId=${schoolId}&fromDate=${fromDate}&toDate=${toDate}`),
      this.clients.request<unknown[]>('audit', `/internal/v1/audit-events?schoolId=${schoolId}`),
    ]);
    return { studentCount: students.length, teacherCount: teachers.length, attendance, notifications, recentAudit: audit.slice(0, 20) };
  }

  @Get('attendance/projection-consistency')
  projectionConsistency(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('attendance', `/internal/v1/attendance/projection-consistency?schoolId=${this.schoolId(principal)}`);
  }

  @Post('attendance/rebuild-projection')
  rebuildProjection(@Body() body: { confirmation?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    if (body.confirmation !== 'REBUILD_FROM_EVENTS') throw new BadRequestException({ code: 'REBUILD_CONFIRMATION_REQUIRED' });
    return this.clients.request('attendance', '/internal/v1/attendance/rebuild-projection', { method: 'POST', body: JSON.stringify({
      schoolId: this.schoolId(principal), actorMembershipId: principal.membershipId, correlationId: currentRequestContext()?.correlationId,
    }) });
  }

  @Get('reports/audit')
  audit(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER' && principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'ADMIN_ROLE_REQUIRED' });
    return this.clients.request('audit', `/internal/v1/audit-events${principal.schoolId ? `?schoolId=${principal.schoolId}` : ''}`);
  }

  @Get('reports/platform-summary')
  async platformSummary(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PLATFORM_OWNER') throw new ForbiddenException({ code: 'PLATFORM_OWNER_ROLE_REQUIRED' });
    const [schools, memberships] = await Promise.all([
      this.clients.request<Array<{ schoolId: string; schoolCode: string; displayName: string; status: string; activeStudentCount: number; totalStudentCount: number }>>('school', '/internal/v1/reports/platform-summary'),
      this.clients.request<Array<{ schoolId: string; activeTeacherCount: number; activeParentCount: number; activeAdminCount: number }>>('identity', '/internal/v1/reports/platform-memberships'),
    ]);
    const counts = new Map(memberships.map((item) => [item.schoolId, item]));
    return { schoolCount: schools.length, activeSchoolCount: schools.filter((item) => item.status === 'ACTIVE').length,
      schools: schools.map((school) => ({ ...school, activeTeacherCount: counts.get(school.schoolId)?.activeTeacherCount ?? 0,
        activeParentCount: counts.get(school.schoolId)?.activeParentCount ?? 0, activeAdminCount: counts.get(school.schoolId)?.activeAdminCount ?? 0 })) };
  }
}

@Controller()
class ContentController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient,
    @Inject('RESOURCE_AUTHORIZATION') private readonly authorization: ResourceAuthorization) {}
  private async guardianAllowed(principal: Principal, studentId: string) {
    await this.authorization.guardian(principal, studentId);
  }
  @Get('timeline/:studentId')
  async timeline(@Param('studentId') studentId: string, @Query('before') before: string | undefined, @Query('limit') limit: string | undefined, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.guardianAllowed(principal, studentId);
    return this.clients.request('read', `/internal/v1/timeline?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${studentId}&limit=${encodeURIComponent(limit ?? '50')}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
  }
  @Get('teacher-posts')
  teacherPosts(@Query('before') before: string | undefined, @Query('limit') limit: string | undefined, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    return this.clients.request('read', `/internal/v1/teacher-posts?schoolId=${principal.schoolId}&authorMembershipId=${principal.membershipId}&limit=${encodeURIComponent(limit ?? '50')}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
  }
  @Get('posts/:postId')
  async post(@Param('postId') postId: string, @Query('studentId') studentId: string | undefined, @CurrentPrincipal() principal: Principal) {
    if (principal.role === 'PARENT') {
      if (!studentId) throw new BadRequestException({ code: 'STUDENT_CONTEXT_REQUIRED' });
      await this.guardianAllowed(principal, studentId);
      return this.clients.request('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${studentId}`);
    }
    if (!['TEACHER','SCHOOL_ADMIN'].includes(principal.role)) throw new ForbiddenException({ code: 'SCHOOL_STAFF_ROLE_REQUIRED' });
    const post = await this.clients.request<{ classId?: string; postType: string; authorMembershipId: string }>('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}`);
    if (principal.role === 'TEACHER' && post.authorMembershipId !== principal.membershipId) throw new ForbiddenException({ code: 'POST_ACCESS_DENIED' });
    return post;
  }
  @Post('posts')
  async create(@Body() body: Record<string, unknown> & { classId?: string; postType?: string; audienceType?: string; scheduledFor?: string; targetStudentId?: string; attachments?: Array<{ fileId?: string; studentId?: string; privacyClassification?: string }> }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !body.classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    const capability = body.postType === 'RESULT' ? 'RESULTS' : body.postType === 'ANNOUNCEMENT' ? 'ANNOUNCEMENTS' : 'ATTENDANCE';
    await this.authorization.teacher(principal, body.classId, capability);
    let audienceType = body.audienceType ?? 'CLASS';
    if (!['CLASS','GRADE','SCHOOL','STUDENT'].includes(audienceType)) throw new BadRequestException({ code: 'AUDIENCE_TYPE_INVALID' });
    if (audienceType === 'STUDENT' && body.postType !== 'RESULT') throw new BadRequestException({ code: 'STUDENT_AUDIENCE_REQUIRES_RESULT' });
    if (body.postType !== 'ANNOUNCEMENT' && !['CLASS','STUDENT'].includes(audienceType)) throw new BadRequestException({ code: 'BROAD_AUDIENCE_ANNOUNCEMENT_ONLY' });
    if (body.scheduledFor && body.postType !== 'ANNOUNCEMENT') throw new BadRequestException({ code: 'SCHEDULE_ANNOUNCEMENT_ONLY' });
    if (body.urgent !== undefined && typeof body.urgent !== 'boolean') throw new BadRequestException({ code: 'URGENT_FLAG_INVALID' });
    if (body.urgent && body.postType !== 'ANNOUNCEMENT') throw new BadRequestException({ code: 'URGENT_ANNOUNCEMENT_ONLY' });
    if (audienceType === 'GRADE' || audienceType === 'SCHOOL' || body.scheduledFor || body.urgent) {
      const [configuration, scope] = await Promise.all([
        this.clients.request<{ scheduledAnnouncementsEnabled: boolean; schoolWideAnnouncementsEnabled: boolean; gradeWideAnnouncementsEnabled: boolean; urgentAnnouncementsEnabled: boolean } | null>('school', `/internal/v1/schools/${principal.schoolId}`),
        this.clients.request<Array<{ classId: string; canPublishSchoolWide: boolean; canPublishGradeWide: boolean; canPublishUrgent: boolean }>>('school', `/internal/v1/schools/${principal.schoolId}/teachers/${principal.membershipId}/scope`),
      ]);
      const grant = scope.find((item) => item.classId === body.classId);
      if (body.scheduledFor && !configuration?.scheduledAnnouncementsEnabled) throw new ForbiddenException({ code: 'SCHEDULED_ANNOUNCEMENTS_DISABLED' });
      if (audienceType === 'GRADE' && (!configuration?.gradeWideAnnouncementsEnabled || !grant?.canPublishGradeWide)) throw new ForbiddenException({ code: 'GRADE_AUDIENCE_NOT_GRANTED' });
      if (audienceType === 'SCHOOL' && (!configuration?.schoolWideAnnouncementsEnabled || !grant?.canPublishSchoolWide)) throw new ForbiddenException({ code: 'SCHOOL_AUDIENCE_NOT_GRANTED' });
      if (body.urgent && (!configuration?.urgentAnnouncementsEnabled || !grant?.canPublishUrgent)) throw new ForbiddenException({ code: 'URGENT_ANNOUNCEMENT_NOT_GRANTED' });
    }
    let recipients = await this.clients.request<Array<{ studentId: string; guardianUserId: string; snapshot: Record<string, unknown> }>>('school', `/internal/v1/schools/${principal.schoolId}/classes/${body.classId}/audience-recipients?audienceType=${audienceType === 'STUDENT' ? 'CLASS' : audienceType}`);
    if (body.postType === 'RESULT') {
      if (!body.targetStudentId) throw new BadRequestException({ code: 'RESULT_STUDENT_REQUIRED' });
      recipients = recipients.filter((recipient) => recipient.studentId === body.targetStudentId);
      if (!recipients.length || !body.attachments?.length || body.attachments.some((attachment) => attachment.studentId !== body.targetStudentId || attachment.privacyClassification !== 'STUDENT_PRIVATE')) throw new BadRequestException({ code: 'RESULT_PRIVACY_MAPPING_REQUIRED' });
      audienceType = 'STUDENT';
    }
    if (!recipients.length) throw new BadRequestException({ code: 'AUDIENCE_HAS_NO_ACTIVE_RECIPIENTS' });
    return this.clients.request('content', '/internal/v1/posts', { method: 'POST', body: JSON.stringify({ ...body, audienceType, recipients, schoolId: principal.schoolId, actorUserId: principal.userId, authorMembershipId: principal.membershipId, correlationId: currentRequestContext()?.correlationId }) });
  }
  @Get('drafts')
  drafts(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    return this.clients.request('content', `/internal/v1/drafts?schoolId=${principal.schoolId}&authorMembershipId=${principal.membershipId}`);
  }
  @Post('drafts')
  async saveDraft(@Body() body: { classId?: string; postType?: string; payload?: Record<string, unknown> }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !body.classId || !body.postType || !body.payload) throw new BadRequestException({ code: 'DRAFT_FIELDS_REQUIRED' });
    const capability = body.postType === 'RESULT' ? 'RESULTS' : body.postType === 'ANNOUNCEMENT' ? 'ANNOUNCEMENTS' : 'ATTENDANCE';
    await this.authorization.teacher(principal, body.classId, capability);
    return this.clients.request('content', '/internal/v1/drafts', { method: 'POST', body: JSON.stringify({ ...body, schoolId: principal.schoolId, authorMembershipId: principal.membershipId }) });
  }
  @Post('drafts/:draftId/delete')
  deleteDraft(@Param('draftId') draftId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    return this.clients.request('content', `/internal/v1/drafts/${draftId}/delete`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, authorMembershipId: principal.membershipId }) });
  }
  @Post('posts/:postId/revisions')
  async revise(@Param('postId') postId: string, @Body() body: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    const post = await this.clients.request<{ classId?: string; postType: string; authorMembershipId: string }>('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}`);
    if (post.authorMembershipId !== principal.membershipId) throw new ForbiddenException({ code: 'POST_EDIT_NOT_AUTHORIZED' });
    if (!post.classId) throw new BadRequestException({ code: 'POST_CLASS_CONTEXT_REQUIRED' });
    const capability = post.postType === 'RESULT' ? 'RESULTS' : post.postType === 'ANNOUNCEMENT' ? 'ANNOUNCEMENTS' : 'ATTENDANCE';
    await this.authorization.teacher(principal, post.classId, capability);
    if (body.urgent !== undefined && typeof body.urgent !== 'boolean') throw new BadRequestException({ code: 'URGENT_FLAG_INVALID' });
    if ((body.urgent || body.scheduledFor) && post.postType !== 'ANNOUNCEMENT') throw new BadRequestException({ code: 'ANNOUNCEMENT_OPTION_INVALID' });
    if (body.urgent || body.scheduledFor) {
      const [config, scope] = await Promise.all([
        this.clients.request<{ urgentAnnouncementsEnabled: boolean; scheduledAnnouncementsEnabled: boolean }>('school', `/internal/v1/schools/${principal.schoolId}`),
        this.clients.request<Array<{ classId: string; canPublishUrgent: boolean }>>('school', `/internal/v1/schools/${principal.schoolId}/teachers/${principal.membershipId}/scope`),
      ]);
      if (body.urgent && (!config.urgentAnnouncementsEnabled || !scope.some((item) => item.classId === post.classId && item.canPublishUrgent))) throw new ForbiddenException({ code: 'URGENT_ANNOUNCEMENT_NOT_GRANTED' });
      if (body.scheduledFor && !config.scheduledAnnouncementsEnabled) throw new ForbiddenException({ code: 'SCHEDULED_ANNOUNCEMENTS_DISABLED' });
    }
    return this.clients.request('content', `/internal/v1/posts/${postId}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ ...body, schoolId: principal.schoolId, actorUserId: principal.userId, authorMembershipId: principal.membershipId, correlationId: currentRequestContext()?.correlationId }),
    });
  }
  @Post('posts/:postId/view')
  async view(@Param('postId') postId: string, @Body() body: { studentId: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.guardianAllowed(principal, body.studentId);
    return this.clients.request('content', `/internal/v1/posts/${postId}/views`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, guardianUserId: principal.userId, studentId: body.studentId }) });
  }

  @Post('posts/:postId/archive')
  async archive(@Param('postId') postId: string, @Body() body: { expectedRevisionNumber?: number }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !Number.isInteger(body.expectedRevisionNumber)) throw new ForbiddenException({ code: 'TEACHER_REVISION_REQUIRED' });
    const post = await this.clients.request<{ authorMembershipId: string; classId: string; postType: string }>('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}`);
    if (post.authorMembershipId !== principal.membershipId) throw new ForbiddenException({ code: 'POST_ARCHIVE_NOT_AUTHORIZED' });
    const capability = post.postType === 'RESULT' ? 'RESULTS' : post.postType === 'ANNOUNCEMENT' ? 'ANNOUNCEMENTS' : 'ATTENDANCE';
    await this.authorization.teacher(principal, post.classId, capability);
    return this.clients.request('content', `/internal/v1/posts/${postId}/archive`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, authorMembershipId: principal.membershipId, actorUserId: principal.userId, expectedRevisionNumber: body.expectedRevisionNumber, correlationId: currentRequestContext()?.correlationId }) });
  }

  @Get('posts/:postId/report')
  async postReport(@Param('postId') postId: string, @CurrentPrincipal() principal: Principal) {
    if (!['TEACHER','SCHOOL_ADMIN'].includes(principal.role)) throw new ForbiddenException({ code: 'SCHOOL_STAFF_ROLE_REQUIRED' });
    const report = await this.clients.request<{ authorMembershipId: string }>('content', `/internal/v1/posts/${postId}/report?schoolId=${principal.schoolId}`);
    if (principal.role === 'TEACHER' && report.authorMembershipId !== principal.membershipId) throw new ForbiddenException({ code: 'POST_REPORT_NOT_AUTHORIZED' });
    const delivery = await this.clients.request('notifications', `/internal/v1/resources/POST/${postId}/report?schoolId=${principal.schoolId}`);
    return { ...report, delivery };
  }
}

@Controller('attendance')
class AttendanceController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient,
    @Inject('RESOURCE_AUTHORIZATION') private readonly authorization: ResourceAuthorization) {}
  @Post('batches')
  async submit(@Body() body: Record<string, unknown> & { classId?: string; rows?: Array<{ studentId?: string; status?: string }> }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !body.classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    await this.authorization.teacher(principal, body.classId, 'ATTENDANCE');
    const [roster, notificationRecipients] = await Promise.all([
      this.clients.request<Array<{ id: string }>>('school', `/internal/v1/schools/${principal.schoolId}/classes/${body.classId}/roster`),
      this.clients.request<Array<{ studentId: string; guardianUserId: string }>>('school', `/internal/v1/schools/${principal.schoolId}/classes/${body.classId}/audience-recipients?audienceType=CLASS`),
    ]);
    const activeStudentIds = new Set(roster.map((student) => student.id));
    if (!body.rows?.length || body.rows.some((row) => !row.studentId || !activeStudentIds.has(row.studentId)) || body.rows.length !== roster.length) {
      throw new BadRequestException({ code: 'ATTENDANCE_ROSTER_MISMATCH' });
    }
    if (Number(body.expectedVersion) > 0) {
      const config = await this.clients.request<{ attendanceEditWindowHours: number } | null>('school', `/internal/v1/schools/${principal.schoolId}`);
      if (!config) throw new ForbiddenException({ code: 'SCHOOL_INACTIVE' });
      const start = Date.parse(`${String(body.attendanceDate)}T00:00:00Z`);
      if (!Number.isFinite(start) || Date.now() - start > (config.attendanceEditWindowHours + 24) * 3_600_000) throw new ForbiddenException({ code: 'ATTENDANCE_EDIT_WINDOW_CLOSED' });
      if (typeof body.correctionReason !== 'string' || body.correctionReason.trim().length < 5) throw new BadRequestException({ code: 'CORRECTION_REASON_REQUIRED' });
    }
    return this.clients.request('attendance', '/internal/v1/attendance/batches', { method: 'POST', body: JSON.stringify({ ...body, schoolId: principal.schoolId,
      notificationRecipients: notificationRecipients.map(({ studentId, guardianUserId }) => ({ studentId, guardianUserId })),
      actorUserId: principal.userId, actorMembershipId: principal.membershipId, correlationId: currentRequestContext()?.correlationId }) });
  }
  @Get('roster')
  async roster(@Query('classId') classId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    await this.authorization.teacher(principal, classId, 'ATTENDANCE');
    return this.clients.request('school', `/internal/v1/schools/${principal.schoolId}/classes/${classId}/roster`);
  }
  @Get('version')
  async version(@Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    await this.authorization.teacher(principal, classId, 'ATTENDANCE');
    return this.clients.request('attendance', `/internal/v1/attendance/version?schoolId=${principal.schoolId}&classId=${classId}&attendanceDate=${encodeURIComponent(attendanceDate)}`);
  }
  @Get('current')
  async current(@Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    await this.authorization.teacher(principal, classId, 'ATTENDANCE');
    return this.clients.request('attendance', `/internal/v1/attendance/current?schoolId=${principal.schoolId}&classId=${classId}&attendanceDate=${attendanceDate}`);
  }
  @Get('follow-ups')
  async followUps(@Query('classId') classId: string, @Query('attendanceDate') attendanceDate: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    await this.authorization.teacher(principal, classId, 'ATTENDANCE');
    const [followUps, roster] = await Promise.all([
      this.clients.request<Array<{ attendanceEventId: string; studentId: string; attendanceStatus: string; responseStatus: string; responseCount: number }>>('attendance', `/internal/v1/attendance/follow-ups?schoolId=${principal.schoolId}&classId=${classId}&attendanceDate=${encodeURIComponent(attendanceDate)}`),
      this.clients.request<Array<{ id: string; displayName: string }>>('school', `/internal/v1/schools/${principal.schoolId}/classes/${classId}/roster`),
    ]);
    const names = new Map(roster.map((student) => [student.id, student.displayName]));
    return followUps.map((item) => ({ ...item, studentName: names.get(item.studentId) ?? 'Student' }));
  }
  @Get('events/:eventId')
  async event(@Param('eventId') eventId: string, @CurrentPrincipal() principal: Principal) {
    const event = await this.clients.request<{ studentId: string; classId: string }>('attendance', `/internal/v1/attendance/events/${eventId}?schoolId=${principal.schoolId}`);
    if (principal.role === 'PARENT') await this.authorization.guardian(principal, event.studentId);
    else await this.authorization.teacher(principal, event.classId, 'ATTENDANCE');
    return event;
  }
  @Post('events/:eventId/acknowledgements')
  async acknowledge(@Param('eventId') eventId: string, @Body() body: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.event(eventId, principal);
    return this.clients.request('attendance', `/internal/v1/attendance/events/${eventId}/acknowledgements`, { method: 'POST', body: JSON.stringify({ ...body, schoolId: principal.schoolId, guardianUserId: principal.userId, actorUserId: principal.userId, correlationId: currentRequestContext()?.correlationId }) });
  }
  @Get('students/:studentId')
  async history(@Param('studentId') studentId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.authorization.guardian(principal, studentId);
    return this.clients.request('attendance', `/internal/v1/students/${studentId}/attendance?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}`);
  }
}

@Controller('notifications')
class NotificationsController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Get() list(@Query('before') before: string | undefined, @Query('limit') limit: string | undefined, @CurrentPrincipal() principal: Principal) { return this.clients.request('notifications', `/internal/v1/notifications?schoolId=${principal.schoolId}&recipientUserId=${principal.userId}&limit=${encodeURIComponent(limit ?? '50')}${before ? `&before=${encodeURIComponent(before)}` : ''}`); }
  @Post(':id/read') read(@Param('id') id: string, @CurrentPrincipal() principal: Principal) { return this.clients.request('notifications', `/internal/v1/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, recipientUserId: principal.userId }) }); }
}

@Controller('files')
class FilesController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient,
    @Inject('RESOURCE_AUTHORIZATION') private readonly authorization: ResourceAuthorization) {}
  @Post('uploads')
  async createUpload(@Body() body: { ownerType?: 'POST' | 'LEAVE_REQUEST'; ownerId?: string; fileName?: string; mediaType?: string; byteSize?: number; checksumSha256?: string }, @CurrentPrincipal() principal: Principal) {
    if (!principal.schoolId || principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_FILE_UPLOAD_REQUIRED' });
    if (body.ownerType !== 'POST' || !body.ownerId || !body.fileName || !body.mediaType || !body.byteSize || !body.checksumSha256) throw new BadRequestException({ code: 'FILE_UPLOAD_FIELDS_REQUIRED' });
    return this.clients.request('files', '/internal/v1/uploads', { method: 'POST', body: JSON.stringify({ ...body, schoolId: principal.schoolId, actorUserId: principal.userId }) });
  }
  @Post('uploads/:uploadSessionId/complete')
  completeUpload(@Param('uploadSessionId') uploadSessionId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !principal.schoolId) throw new ForbiddenException({ code: 'TEACHER_FILE_UPLOAD_REQUIRED' });
    return this.clients.request('files', `/internal/v1/uploads/${uploadSessionId}/complete`, { method: 'POST', body: JSON.stringify({ actorUserId: principal.userId, schoolId: principal.schoolId }) });
  }
  @Post(':fileId/access')
  async access(@Param('fileId') fileId: string, @Body() body: { studentId?: string }, @CurrentPrincipal() principal: Principal) {
    if (!principal.schoolId) throw new ForbiddenException({ code: 'SCHOOL_CONTEXT_REQUIRED' });
    const context = await this.clients.request<{ postId: string; authorMembershipId: string; classId: string; studentId?: string; privacyClassification: string }>('content', `/internal/v1/files/${fileId}/context?schoolId=${principal.schoolId}`);
    let authorized = false;
    if (principal.role === 'PARENT' && body.studentId && (!context.studentId || context.studentId === body.studentId)) {
      await this.clients.request('content', `/internal/v1/posts/${context.postId}?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${body.studentId}`);
      await this.authorization.guardian(principal, body.studentId);
      authorized = true;
    } else if (principal.role === 'TEACHER') authorized = context.authorMembershipId === principal.membershipId;
    if (!authorized) throw new ForbiddenException({ code: 'FILE_ACCESS_DENIED' });
    return this.clients.request('files', `/internal/v1/files/${fileId}/access`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, actorUserId: principal.userId, studentId: body.studentId, authorized: true }) });
  }
}

@Module({
  controllers: [HealthController, AuthController, MeController, MobileBffController, AdminController, ContentController, AttendanceController, NotificationsController, FilesController],
  providers: [ServiceClient, resourceAuthorizationProvider, { provide: APP_GUARD, useClass: SessionGuard }, { provide: APP_GUARD, useClass: RoutePolicyGuard }, { provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
