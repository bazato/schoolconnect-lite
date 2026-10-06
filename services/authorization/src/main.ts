import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { Body, Controller, Get, Inject, Injectable, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PolicyEngine, RoutePolicy, type Principal, type ResourceDecision } from './policy';

@Injectable()
class AuthorizationPolicy {
  private readonly routes = new RoutePolicy();
  private readonly engine = new PolicyEngine(async (path) => {
    const response = await fetch(`${process.env.SCHOOL_SERVICE_URL ?? 'http://127.0.0.1:3102'}${path}`, {
      headers: process.env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN } : {}, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`SCHOOL_RELATIONSHIP_UNAVAILABLE_${response.status}`);
    return response.json() as Promise<{ allowed: boolean }>;
  });
  decide(input: ResourceDecision) { return this.engine.decide(input); }
  decideRoute(input: { method: string; path: string; principal: Principal }) { return this.routes.decide(input.method, input.path, input.principal?.role); }
}

@Controller('internal/v1')
class AuthorizationController {
  constructor(@Inject(AuthorizationPolicy) private readonly policy: AuthorizationPolicy) {}
  @Get('health') health() { return { status: 'ok', service: 'authorization' }; }
  @Post('decisions') decide(@Body() body: ResourceDecision) { return this.policy.decide(body); }
  @Post('decisions/route') decideRoute(@Body() body: { method: string; path: string; principal: Principal }) { return this.policy.decideRoute(body); }
}
@Module({ controllers: [AuthorizationController], providers: [AuthorizationPolicy] }) class AuthorizationModule {}
async function bootstrap() {
  const app = await NestFactory.create(AuthorizationModule);
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (process.env.NODE_ENV === 'production' && (!token || token.length < 32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED');
  if (token) app.use((request: { headers: Record<string, string | string[] | undefined> }, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => request.headers['x-internal-service-token'] === token ? next() : response.status(401).json({ code: 'INTERNAL_AUTHENTICATION_REQUIRED' }));
  await app.listen(Number(process.env.AUTHORIZATION_PORT ?? 3108), process.env.SERVICE_BIND_HOST ?? '127.0.0.1');
}
void bootstrap();
