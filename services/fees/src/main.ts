import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Inject, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startOutboxPublisher } from '@schoolconnect/eventing';
import { parseFeeQuery, type FeeQuery } from '@schoolconnect/contracts';
import { FeesRepository, type ImportContext } from './repository';

@Controller('internal/v1')
class FeesController {
  constructor(@Inject(FeesRepository) private readonly repository: FeesRepository) {}
  private scope(body: { schoolId: string }, header?: string) { if (!header || body.schoolId !== header || !/^[0-9a-f-]{36}$/i.test(header)) throw new ForbiddenException({ code: 'FEE_SCHOOL_SCOPE_REQUIRED' }); }
  @Get('health') health() { return this.repository.health(); }
  @Post('fees/import-preview') preview(@Body() body: ImportContext, @Headers('x-schoolconnect-school-id') schoolId?: string) { this.scope(body,schoolId); return this.repository.preview(body); }
  @Post('fees/import-commit') commit(@Body() body: ImportContext & { batchId: string; revision: number }, @Headers('x-schoolconnect-school-id') schoolId?: string) {
    this.scope(body,schoolId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.batchId) || !Number.isInteger(body.revision) || body.revision < 0) throw new BadRequestException({ code: 'FEE_BATCH_AND_REVISION_REQUIRED' });
    return this.repository.commit(body);
  }
  @Post('fees/report') report(@Body() body: { schoolId: string; question: string; timezone: string; studentIds: string[] | null }, @Headers('x-schoolconnect-school-id') schoolId?: string) {
    this.scope(body,schoolId);
    let query: FeeQuery;
    try { query = parseFeeQuery(body.question,body.timezone); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Invalid fee question.'); }
    if (query.grade && !Array.isArray(body.studentIds) || !query.grade && body.studentIds !== null) throw new BadRequestException({ code: 'FEE_GRADE_SCOPE_REQUIRED' });
    return this.repository.report(body.schoolId,query,body.studentIds);
  }
}
@Module({ controllers: [FeesController], providers: [FeesRepository] }) class FeesModule {}
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(FeesModule, { bodyParser:false });
  app.useBodyParser('json',{ limit:'512kb' });
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (process.env.NODE_ENV === 'production' && (!token || token.length < 32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED');
  if (token) app.use((request: { headers: Record<string,string | string[] | undefined> }, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => request.headers['x-internal-service-token'] === token ? next() : response.status(401).json({ code:'INTERNAL_AUTHENTICATION_REQUIRED' }));
  await app.listen(Number(process.env.FEES_PORT ?? 3110),process.env.SERVICE_BIND_HOST ?? '127.0.0.1');
  const close = await startOutboxPublisher('fees',app.get(FeesRepository));
  app.enableShutdownHooks();
  process.once('SIGTERM', () => { void close(); });
}
void bootstrap();
