import {
  BadGatewayException, BadRequestException, Body, CanActivate, ConflictException, Controller, createParamDecorator,
  ExecutionContext, ForbiddenException, Get, Inject, Injectable, Module, NotFoundException, Param, Post, Query, SetMetadata,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

type Role = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
type Principal = { userId: string; displayName: string; membershipId: string; schoolId: string | null; role: Role };
type ScopedRequest = Request & { principal?: Principal };
type ServiceName = 'identity' | 'school' | 'content' | 'attendance' | 'files' | 'notifications' | 'audit';

const IS_PUBLIC = 'schoolconnect:is-public';
const Public = () => SetMetadata(IS_PUBLIC, true);
const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<ScopedRequest>().principal);

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
  };

  async request<T>(service: ServiceName, path: string, init?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${this.urls[service]}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-correlation-id': randomUUID(), ...init?.headers },
        signal: AbortSignal.timeout(5_000),
      });
      const payload = await response.json().catch(() => ({ code: 'INVALID_SERVICE_RESPONSE' })) as T & { message?: unknown };
      if (!response.ok) {
        const message = typeof payload.message === 'object' ? payload.message : payload;
        if (response.status === 400) throw new BadRequestException(message);
        if (response.status === 403) throw new ForbiddenException(message);
        if (response.status === 404) throw new NotFoundException(message);
        if (response.status === 409) throw new ConflictException(message);
        throw new BadGatewayException({ code: 'DOWNSTREAM_REJECTED', service, status: response.status, details: message });
      }
      return payload;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof BadGatewayException) throw error;
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
    if (!authorization?.startsWith('Bearer ')) throw new ForbiddenException({ code: 'AUTHENTICATION_REQUIRED' });
    request.principal = await this.clients.request<Principal>('identity', '/internal/v1/sessions/context', {
      method: 'POST', body: JSON.stringify({ accessToken: authorization.slice(7) }),
    });
    return true;
  }
}

@Controller('health')
class HealthController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Public() @Get()
  async health() {
    const services = await Promise.all((['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'audit'] as ServiceName[])
      .map(async (service) => {
        try { await this.clients.request(service, '/internal/v1/health'); return { service, status: 'ok' }; }
        catch { return { service, status: 'unavailable' }; }
      }));
    return { status: services.every((item) => item.status === 'ok') ? 'ok' : 'degraded', architecture: 'microservices', services };
  }
}

@Controller('auth')
class AuthController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Public() @Post('otp/request') request(@Body() body: { phoneE164: string; invitationCode: string }) {
    return this.clients.request('identity', '/internal/v1/otp/request', { method: 'POST', body: JSON.stringify(body) });
  }
  @Public() @Post('otp/verify') verify(@Body() body: { challengeId: string; code: string; deviceId?: string }) {
    return this.clients.request('identity', '/internal/v1/otp/verify', { method: 'POST', body: JSON.stringify(body) });
  }
  @Post('switch-role')
  switchRole(@Body() body: { membershipId?: string }, @CurrentPrincipal() principal: Principal) {
    if (!body.membershipId) throw new BadRequestException({ code: 'MEMBERSHIP_REQUIRED' });
    return this.clients.request('identity', '/internal/v1/sessions/switch-membership', {
      method: 'POST', body: JSON.stringify({ userId: principal.userId, membershipId: body.membershipId }),
    });
  }
  @Post('logout') logout() { return { revoked: true, note: 'Development token has no server secret; production refresh-token rotation remains provider work.' }; }
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
    const administrator = await this.clients.request<{ userId: string; membershipId: string; role: Role; invitationCode: string; expiresAt: string }>('identity', '/internal/v1/provisioning/accounts', {
      method: 'POST', body: JSON.stringify({ schoolId: school.id, role: 'SCHOOL_ADMIN', phoneE164: body.adminPhoneE164, displayName: body.adminDisplayName }),
    });
    return { school, administrator };
  }

  @Get('classes')
  classes(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/classes`);
  }

  @Post('classes')
  createClass(@Body() body: { classCode?: string; displayName?: string; academicYear?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('school', `/internal/v1/schools/${this.schoolId(principal)}/classes`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }

  @Get('teachers')
  teachers(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'SCHOOL_ADMIN') throw new ForbiddenException({ code: 'SCHOOL_ADMIN_ROLE_REQUIRED' });
    return this.clients.request('identity', `/internal/v1/schools/${this.schoolId(principal)}/members?role=TEACHER`);
  }

  @Post('teachers')
  async createTeacher(@Body() body: { displayName?: string; phoneE164?: string; classId?: string; subjectCode?: string; subjectName?: string; canPublishResults?: boolean; canPublishAnnouncements?: boolean; canRecordAttendance?: boolean }, @CurrentPrincipal() principal: Principal) {
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
    const assignment = await this.clients.request('school', `/internal/v1/schools/${schoolId}/teacher-assignments`, {
      method: 'POST',
      body: JSON.stringify({
        teacherMembershipId: teacher.membershipId,
        classId: body.classId,
        subjectCode: body.subjectCode,
        subjectName: body.subjectName,
        canPublishResults: body.canPublishResults ?? false,
        canPublishAnnouncements: body.canPublishAnnouncements ?? true,
        canRecordAttendance: body.canRecordAttendance ?? true,
      }),
    });
    return { teacher, assignment };
  }
}

@Controller()
class ContentController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  private async guardianAllowed(principal: Principal, studentId: string) {
    const result = await this.clients.request<{ allowed: boolean }>('school', `/internal/v1/authorization/guardian?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${studentId}`);
    if (!result.allowed) throw new ForbiddenException({ code: 'GUARDIAN_CHILD_ACCESS_DENIED' });
  }
  @Get('timeline/:studentId')
  async timeline(@Param('studentId') studentId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.guardianAllowed(principal, studentId);
    return this.clients.request('content', `/internal/v1/timeline?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${studentId}`);
  }
  @Get('teacher-posts')
  teacherPosts(@CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    return this.clients.request('content', `/internal/v1/teacher-posts?schoolId=${principal.schoolId}&authorMembershipId=${principal.membershipId}`);
  }
  @Get('posts/:postId')
  async post(@Param('postId') postId: string, @Query('studentId') studentId: string | undefined, @CurrentPrincipal() principal: Principal) {
    if (principal.role === 'PARENT') {
      if (!studentId) throw new BadRequestException({ code: 'STUDENT_CONTEXT_REQUIRED' });
      await this.guardianAllowed(principal, studentId);
      return this.clients.request('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${studentId}`);
    }
    const post = await this.clients.request<{ classId?: string }>('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}`);
    if (post.classId) {
      const allowed = await this.clients.request<{ allowed: boolean }>('school', `/internal/v1/authorization/teacher?schoolId=${principal.schoolId}&membershipId=${principal.membershipId}&classId=${post.classId}&capability=ATTENDANCE`);
      if (!allowed.allowed) throw new ForbiddenException({ code: 'TEACHER_ASSIGNMENT_ACCESS_DENIED' });
    }
    return post;
  }
  @Post('posts')
  async create(@Body() body: Record<string, unknown> & { classId?: string; postType?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !body.classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    const capability = body.postType === 'RESULT' ? 'RESULTS' : body.postType === 'ANNOUNCEMENT' ? 'ANNOUNCEMENTS' : 'ATTENDANCE';
    const allowed = await this.clients.request<{ allowed: boolean }>('school', `/internal/v1/authorization/teacher?schoolId=${principal.schoolId}&membershipId=${principal.membershipId}&classId=${body.classId}&capability=${capability}`);
    if (!allowed.allowed) throw new ForbiddenException({ code: 'TEACHER_ASSIGNMENT_ACCESS_DENIED' });
    const recipients = await this.clients.request<Array<{ studentId: string; guardianUserId: string; snapshot: Record<string, unknown> }>>('school', `/internal/v1/schools/${principal.schoolId}/classes/${body.classId}/recipients`);
    if (!recipients.length) throw new BadRequestException({ code: 'AUDIENCE_HAS_NO_ACTIVE_RECIPIENTS' });
    return this.clients.request('content', '/internal/v1/posts', { method: 'POST', body: JSON.stringify({ ...body, recipients, schoolId: principal.schoolId, actorUserId: principal.userId, authorMembershipId: principal.membershipId }) });
  }
  @Post('posts/:postId/revisions')
  async revise(@Param('postId') postId: string, @Body() body: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER') throw new ForbiddenException({ code: 'TEACHER_ROLE_REQUIRED' });
    const post = await this.clients.request<{ classId?: string; postType: string; authorMembershipId: string }>('content', `/internal/v1/posts/${postId}?schoolId=${principal.schoolId}`);
    if (post.authorMembershipId !== principal.membershipId) throw new ForbiddenException({ code: 'POST_EDIT_NOT_AUTHORIZED' });
    if (!post.classId) throw new BadRequestException({ code: 'POST_CLASS_CONTEXT_REQUIRED' });
    const capability = post.postType === 'RESULT' ? 'RESULTS' : post.postType === 'ANNOUNCEMENT' ? 'ANNOUNCEMENTS' : 'ATTENDANCE';
    const allowed = await this.clients.request<{ allowed: boolean }>('school', `/internal/v1/authorization/teacher?schoolId=${principal.schoolId}&membershipId=${principal.membershipId}&classId=${post.classId}&capability=${capability}`);
    if (!allowed.allowed) throw new ForbiddenException({ code: 'TEACHER_ASSIGNMENT_ACCESS_DENIED' });
    return this.clients.request('content', `/internal/v1/posts/${postId}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ ...body, schoolId: principal.schoolId, actorUserId: principal.userId, authorMembershipId: principal.membershipId }),
    });
  }
  @Post('posts/:postId/view')
  async view(@Param('postId') postId: string, @Body() body: { studentId: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.guardianAllowed(principal, body.studentId);
    return this.clients.request('content', `/internal/v1/posts/${postId}/views`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, guardianUserId: principal.userId, studentId: body.studentId }) });
  }
}

@Controller('attendance')
class AttendanceController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Post('batches')
  async submit(@Body() body: Record<string, unknown> & { classId?: string }, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'TEACHER' || !body.classId) throw new ForbiddenException({ code: 'TEACHER_CLASS_CONTEXT_REQUIRED' });
    const allowed = await this.clients.request<{ allowed: boolean }>('school', `/internal/v1/authorization/teacher?schoolId=${principal.schoolId}&membershipId=${principal.membershipId}&classId=${body.classId}&capability=ATTENDANCE`);
    if (!allowed.allowed) throw new ForbiddenException({ code: 'TEACHER_ASSIGNMENT_ACCESS_DENIED' });
    return this.clients.request('attendance', '/internal/v1/attendance/batches', { method: 'POST', body: JSON.stringify({ ...body, schoolId: principal.schoolId, actorUserId: principal.userId, actorMembershipId: principal.membershipId }) });
  }
  @Get('events/:eventId')
  async event(@Param('eventId') eventId: string, @CurrentPrincipal() principal: Principal) {
    const event = await this.clients.request<{ studentId: string; classId: string }>('attendance', `/internal/v1/attendance/events/${eventId}?schoolId=${principal.schoolId}`);
    const url = principal.role === 'PARENT'
      ? `/internal/v1/authorization/guardian?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${event.studentId}`
      : `/internal/v1/authorization/teacher?schoolId=${principal.schoolId}&membershipId=${principal.membershipId}&classId=${event.classId}&capability=ATTENDANCE`;
    const allowed = await this.clients.request<{ allowed: boolean }>('school', url);
    if (!allowed.allowed) throw new ForbiddenException({ code: 'ATTENDANCE_ACCESS_DENIED' });
    return event;
  }
  @Post('events/:eventId/acknowledgements')
  async acknowledge(@Param('eventId') eventId: string, @Body() body: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    await this.event(eventId, principal);
    return this.clients.request('attendance', `/internal/v1/attendance/events/${eventId}/acknowledgements`, { method: 'POST', body: JSON.stringify({ ...body, schoolId: principal.schoolId, guardianUserId: principal.userId, actorUserId: principal.userId }) });
  }
  @Get('students/:studentId')
  async history(@Param('studentId') studentId: string, @CurrentPrincipal() principal: Principal) {
    if (principal.role !== 'PARENT') throw new ForbiddenException({ code: 'PARENT_ROLE_REQUIRED' });
    const allowed = await this.clients.request<{ allowed: boolean }>('school', `/internal/v1/authorization/guardian?schoolId=${principal.schoolId}&guardianUserId=${principal.userId}&studentId=${studentId}`);
    if (!allowed.allowed) throw new ForbiddenException({ code: 'GUARDIAN_CHILD_ACCESS_DENIED' });
    return this.clients.request('attendance', `/internal/v1/students/${studentId}/attendance?schoolId=${principal.schoolId}`);
  }
}

@Controller('notifications')
class NotificationsController {
  constructor(@Inject(ServiceClient) private readonly clients: ServiceClient) {}
  @Get() list(@CurrentPrincipal() principal: Principal) { return this.clients.request('notifications', `/internal/v1/notifications?schoolId=${principal.schoolId}&recipientUserId=${principal.userId}`); }
  @Post(':id/read') read(@Param('id') id: string, @CurrentPrincipal() principal: Principal) { return this.clients.request('notifications', `/internal/v1/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({ schoolId: principal.schoolId, recipientUserId: principal.userId }) }); }
}

@Module({
  controllers: [HealthController, AuthController, MeController, AdminController, ContentController, AttendanceController, NotificationsController],
  providers: [ServiceClient, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
