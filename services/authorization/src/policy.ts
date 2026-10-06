export type Principal = { userId: string; membershipId: string; schoolId: string | null; role: 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT' };
export type ResourceDecision = { action: 'TEACHER_CLASS' | 'GUARDIAN_CHILD'; principal: Principal; classId?: string; studentId?: string; capability?: 'RESULTS' | 'ANNOUNCEMENTS' | 'ATTENDANCE' };
export type RelationshipClient = (path: string) => Promise<{ allowed: boolean }>;
export type RouteRule = { methods: string[]; pattern: string; roles: Principal['role'][] };

const allRoles: Principal['role'][] = ['PLATFORM_OWNER','SCHOOL_ADMIN','TEACHER','PARENT'];
export const defaultRouteRules: RouteRule[] = [
  { methods: ['POST'], pattern: '^/api/v1/auth/(switch-role|logout)$', roles: allRoles },
  { methods: ['GET'], pattern: '^/api/v1/me/context$', roles: allRoles },
  { methods: ['GET'], pattern: '^/api/v1/me/teaching-scope$', roles: ['TEACHER'] },
  { methods: ['GET'], pattern: '^/api/v1/me/children$', roles: ['PARENT'] },
  { methods: ['GET'], pattern: '^/api/v1/bff/parent/home$', roles: ['PARENT'] },
  { methods: ['GET'], pattern: '^/api/v1/bff/teacher/home$', roles: ['TEACHER'] },
  { methods: ['GET'], pattern: '^/api/v1/bff/admin/home$', roles: ['SCHOOL_ADMIN'] },
  { methods: ['GET','POST','PATCH'], pattern: '^/api/v1/admin/(schools(?:/[^/]+(?:/admins(?:/[^/]+(?:/reissue-invitation)?)?)?)?|platform-owners(?:/[^/]+(?:/reissue-invitation)?)?|reports/platform-summary)$', roles: ['PLATFORM_OWNER'] },
  { methods: ['GET'], pattern: '^/api/v1/admin/reports/audit$', roles: ['PLATFORM_OWNER','SCHOOL_ADMIN'] },
  { methods: ['GET','POST','PATCH'], pattern: '^/api/v1/admin/.+$', roles: ['SCHOOL_ADMIN'] },
  { methods: ['GET'], pattern: '^/api/v1/timeline/[^/]+$', roles: ['PARENT'] },
  { methods: ['GET'], pattern: '^/api/v1/teacher-posts$', roles: ['TEACHER'] },
  { methods: ['GET'], pattern: '^/api/v1/posts/[^/]+$', roles: ['PARENT','TEACHER','SCHOOL_ADMIN'] },
  { methods: ['GET'], pattern: '^/api/v1/posts/[^/]+/report$', roles: ['TEACHER','SCHOOL_ADMIN'] },
  { methods: ['POST'], pattern: '^/api/v1/posts$', roles: ['TEACHER'] },
  { methods: ['POST'], pattern: '^/api/v1/posts/[^/]+/view$', roles: ['PARENT'] },
  { methods: ['POST'], pattern: '^/api/v1/posts/[^/]+/(revisions|archive)$', roles: ['TEACHER'] },
  { methods: ['GET','POST'], pattern: '^/api/v1/drafts(?:/[^/]+/delete)?$', roles: ['TEACHER'] },
  { methods: ['POST'], pattern: '^/api/v1/attendance/batches$', roles: ['TEACHER'] },
  { methods: ['GET'], pattern: '^/api/v1/attendance/(roster|version|current|follow-ups)$', roles: ['TEACHER'] },
  { methods: ['GET'], pattern: '^/api/v1/attendance/events/[^/]+$', roles: ['TEACHER','PARENT'] },
  { methods: ['POST'], pattern: '^/api/v1/attendance/events/[^/]+/acknowledgements$', roles: ['PARENT'] },
  { methods: ['GET'], pattern: '^/api/v1/attendance/students/[^/]+$', roles: ['PARENT'] },
  { methods: ['GET','POST'], pattern: '^/api/v1/notifications(?:/[^/]+/read)?$', roles: allRoles },
  { methods: ['POST'], pattern: '^/api/v1/files/uploads(?:/[^/]+/complete)?$', roles: ['TEACHER'] },
  { methods: ['POST'], pattern: '^/api/v1/files/[^/]+/access$', roles: ['TEACHER','PARENT'] },
];

export class RoutePolicy {
  private readonly rules: Array<RouteRule & { matcher: RegExp }>;
  constructor(configured = process.env.AUTHORIZATION_ROUTE_RULES_JSON) {
    const parsed: unknown = configured ? JSON.parse(configured) : defaultRouteRules;
    if (!Array.isArray(parsed)) throw new Error('AUTHORIZATION_ROUTE_RULES_INVALID');
    this.rules = parsed.map((rule: RouteRule) => {
      if (!Array.isArray(rule.methods) || rule.methods.some((method) => !['GET','POST','PATCH','DELETE'].includes(method)) ||
        !Array.isArray(rule.roles) || rule.roles.some((role) => !allRoles.includes(role)) || typeof rule.pattern !== 'string' ||
        !rule.pattern.startsWith('^') || !rule.pattern.endsWith('$') || rule.pattern.length > 500) throw new Error('AUTHORIZATION_ROUTE_RULES_INVALID');
      return { ...rule, matcher: new RegExp(rule.pattern) };
    });
  }
  decide(method: string, path: string, role: Principal['role']) {
    if (!['GET','POST','PATCH','DELETE'].includes(method) || !path.startsWith('/api/v1/') || !allRoles.includes(role)) return { allowed: false, reason: 'ROUTE_INVALID' };
    const rule = this.rules.find((candidate) => candidate.methods.includes(method) && candidate.matcher.test(path));
    return { allowed: Boolean(rule?.roles.includes(role)), reason: rule ? 'ROUTE_POLICY' : 'ROUTE_UNCONFIGURED' };
  }
}

export class PolicyEngine {
  private readonly roleRules: Record<ResourceDecision['action'], string[]>;
  constructor(private readonly relationships: RelationshipClient, configured = process.env.AUTHORIZATION_RESOURCE_ROLES_JSON) {
    const defaults: Record<ResourceDecision['action'], string[]> = { TEACHER_CLASS: ['TEACHER'], GUARDIAN_CHILD: ['PARENT'] };
    const overrides: unknown = configured ? JSON.parse(configured) : {};
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('AUTHORIZATION_RESOURCE_ROLES_INVALID');
    const candidate = { ...defaults, ...overrides as Record<string, unknown> };
    for (const action of Object.keys(defaults) as ResourceDecision['action'][]) {
      if (!Array.isArray(candidate[action]) || candidate[action].some((role: unknown) => !['PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT'].includes(String(role)))) throw new Error('AUTHORIZATION_RESOURCE_ROLES_INVALID');
    }
    this.roleRules = candidate as Record<ResourceDecision['action'], string[]>;
  }

  async decide(input: ResourceDecision): Promise<{ allowed: boolean; reason: string }> {
    const { principal } = input;
    if (!principal?.userId || !principal.membershipId || !principal.schoolId || !this.roleRules[input.action]?.includes(principal.role)) return { allowed: false, reason: 'ROLE_OR_SCHOOL_DENIED' };
    let path: string;
    if (input.action === 'TEACHER_CLASS') {
      if (!input.classId || !['RESULTS', 'ANNOUNCEMENTS', 'ATTENDANCE'].includes(String(input.capability))) return { allowed: false, reason: 'RESOURCE_CONTEXT_MISSING' };
      path = `/internal/v1/authorization/teacher?schoolId=${encodeURIComponent(principal.schoolId)}&membershipId=${encodeURIComponent(principal.membershipId)}&classId=${encodeURIComponent(input.classId)}&capability=${encodeURIComponent(input.capability!)}`;
    } else if (input.action === 'GUARDIAN_CHILD') {
      if (!input.studentId) return { allowed: false, reason: 'RESOURCE_CONTEXT_MISSING' };
      path = `/internal/v1/authorization/guardian?schoolId=${encodeURIComponent(principal.schoolId)}&guardianUserId=${encodeURIComponent(principal.userId)}&studentId=${encodeURIComponent(input.studentId)}`;
    } else return { allowed: false, reason: 'UNKNOWN_ACTION' };
    const relationship = await this.relationships(path);
    return { allowed: relationship.allowed === true, reason: relationship.allowed ? 'RELATIONSHIP_ALLOWED' : 'RELATIONSHIP_DENIED' };
  }
}
