import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException, Headers, Param, Post, Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventReplayError, bindEventingShutdown, registerApplicationShutdown, startEventConsumer } from '@schoolconnect/eventing';
import { ReadRepository } from './repository';


@Controller('internal/v1')
class ReadController {
  constructor(@Inject(ReadRepository) private readonly repository: ReadRepository) {}
  @Get('health') health() { return this.repository.health(); }
  @Get('events/status') eventsStatus() { return this.repository.eventingDiagnostics(); }
  @Post('events/failures/:id/retry')
  async replayFailure(@Param('id') id: string,@Headers('x-schoolconnect-user-id') actorUserId?: string) {
    if (!actorUserId || !/^[0-9a-f-]{36}$/i.test(actorUserId)) throw new ForbiddenException({code:'EVENT_REPLAY_ACTOR_REQUIRED'});
    try { return await this.repository.replayFailure(id,actorUserId); }
    catch (error) {
      if (error instanceof EventReplayError) {
        if (error.message==='EVENT_FAILURE_NOT_FOUND') throw new NotFoundException({code:error.message});
        throw new ConflictException({code:error.message});
      }
      throw error;
    }
  }
  @Get('timeline') timeline(@Query('schoolId') schoolId: string,@Query('guardianUserId') guardianUserId: string,@Query('studentId') studentId: string,@Query('before') before?: string,@Query('limit') limit='50',@Query('guardianUserIds') guardianUserIds?:string) { return this.repository.parentTimeline(schoolId,guardianUserId,studentId,before,Number(limit),guardianUserIds?.split(',')); }
  @Get('teacher-posts') posts(@Query('schoolId') schoolId: string,@Query('authorMembershipId') authorMembershipId: string,@Query('before') before?: string,@Query('limit') limit='50') { return this.repository.teacherPosts(schoolId,authorMembershipId,before,Number(limit)); }
  @Get('attendance/summary') summary(@Query('schoolId') schoolId: string,@Query('fromDate') fromDate: string,@Query('toDate') toDate: string) { return this.repository.attendanceSummary(schoolId,fromDate,toDate); }
}
@Module({ controllers: [ReadController],providers: [ReadRepository] }) class ReadModule {}
async function bootstrap() {
  const app = await NestFactory.create(ReadModule);
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (process.env.NODE_ENV === 'production' && (!token || token.length < 32)) throw new Error('INTERNAL_SERVICE_TOKEN_REQUIRED');
  if (token) app.use((request: { headers: Record<string,string|string[]|undefined> }, response: { status: (code:number) => { json: (body:unknown) => void } }, next: () => void) => request.headers['x-internal-service-token'] === token ? next() : response.status(401).json({ code: 'INTERNAL_AUTHENTICATION_REQUIRED' }));
  await app.listen(Number(process.env.READ_PORT ?? 3109), process.env.SERVICE_BIND_HOST ?? '127.0.0.1');
  const repository = app.get(ReadRepository);
  bindEventingShutdown(repository,await startEventConsumer('schoolconnect-read-model-v1', (event) => repository.consume(event),{failureStore:repository.failures}));
  registerApplicationShutdown(app);
}
void bootstrap();
