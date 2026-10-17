import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { Body, Controller, Get, Headers, Inject, Module, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateManagedRuntime } from '@schoolconnect/contracts';
import { eventingHealth, bindEventingShutdown, registerApplicationShutdown, startOutboxPublisher } from '@schoolconnect/eventing';
import { createMalwareScanner, createPrivateObjectStorage, type MalwareScanner, type PrivateObjectStorage } from './storage';
import { FileRepository } from './repository';
import { fileCapabilities } from './file-policy';
import { runFileReleaseCheck } from './release-check';
export { FileRepository } from './repository';

@Controller('internal/v1')
class FileController {
  constructor(@Inject(FileRepository) private readonly repository:FileRepository) {}
  @Get('files/capabilities') capabilities(){return this.repository.capabilities();}
  @Get('health') async health(){return {status:eventingHealth('publisher:files'),service:'files',database:await this.repository.health(),configuration:fileCapabilities(),scannerReadinessPath:'/internal/v1/files/capabilities'};}
  @Get('events/status') eventsStatus(){return this.repository.eventingDiagnostics();}
  @Post('uploads') upload(@Body() body:Parameters<FileRepository['createUpload']>[0]){return this.repository.createUpload(body);}
  @Post('uploads/:uploadSessionId/complete') complete(@Param('uploadSessionId') id:string,@Body() body:{actorUserId:string;schoolId:string},@Headers('x-correlation-id') correlationId?:string){return this.repository.completeUpload(id,body.actorUserId,body.schoolId,correlationId);}
  @Post('files/validate-attachments') validate(@Body() body:Parameters<FileRepository['validateAttachments']>[0]){return this.repository.validateAttachments(body);}
  @Post('files/:fileId/access') access(@Param('fileId') id:string,@Body() body:Parameters<FileRepository['access']>[1]){return this.repository.access(id,body);}
  @Get('outbox') outbox(@Query('limit') limit='25'){return this.repository.claimOutbox(Number(limit));}
  @Post('outbox/:eventId/complete') completeOutbox(@Param('eventId') id:string,@Body() body:{success?:boolean;claimToken?:string}){return this.repository.completeOutbox(id,body.success===true,body.claimToken);}
}
@Module({controllers:[FileController],providers:[
  {provide:'PRIVATE_OBJECT_STORAGE',useFactory:()=>createPrivateObjectStorage()},
  {provide:'MALWARE_SCANNER',useFactory:()=>createMalwareScanner()},
  {provide:FileRepository,useFactory:(storage:PrivateObjectStorage,scanner:MalwareScanner)=>new FileRepository(storage,scanner),inject:['PRIVATE_OBJECT_STORAGE','MALWARE_SCANNER']},
]})class FileModule {}
async function bootstrap(){
  if(process.env.NODE_ENV==='production')validateManagedRuntime(process.env,'files');
  const app=await NestFactory.create(FileModule),token=process.env.INTERNAL_SERVICE_TOKEN;
  if(process.env.NODE_ENV==='production'&&(!token||token.length<32))throw Error('INTERNAL_SERVICE_TOKEN_REQUIRED');
  if(token)app.use((request:{headers:Record<string,string|string[]|undefined>},response:{status:(code:number)=>{json:(body:unknown)=>void}},next:()=>void)=>request.headers['x-internal-service-token']===token?next():response.status(401).json({code:'INTERNAL_AUTHENTICATION_REQUIRED'}));
  const repository=app.get(FileRepository);
  if(process.env.FILE_RELEASE_SELF_TEST==='true'){
    try{
      const result=await runFileReleaseCheck(app.get<PrivateObjectStorage>('PRIVATE_OBJECT_STORAGE'),app.get<MalwareScanner>('MALWARE_SCANNER'));
      console.info(JSON.stringify({event:'file-release-check',...result}));
    }catch(error){
      const code=error instanceof Error&&/^(RELEASE_[A-Z_]+|FILE_SCANNER_[A-Z_]+)$/.test(error.message)?error.message:'FILE_RELEASE_CHECK_FAILED';
      const diagnostic=error as {code?:string;name?:string;releaseStep?:string;validationReason?:string;httpStatus?:number};
      const detail=['42P01','42501','42703','53300','ETIMEDOUT','ECONNRESET','ECONNREFUSED'].includes(diagnostic.code??'')?diagnostic.code:undefined;
      const errorName=['Error','TypeError','CredentialsProviderError','AccessDenied','SignatureDoesNotMatch','InvalidAccessKeyId','NoSuchBucket','TimeoutError','AbortError'].includes(diagnostic.name??'')?diagnostic.name:undefined;
      const step=['scanner_health','presigned_upload','create_only_upload','read_and_validate','scan_final_bytes','immutable_storage','signed_download','anonymous_denial'].includes(diagnostic.releaseStep??'')?diagnostic.releaseStep:undefined;
      const validationReason=['invalid_json','invalid_clean_verdict','invalid_virus_collection','invalid_threat_flag'].includes(diagnostic.validationReason??'')?diagnostic.validationReason:undefined;
      const httpStatus=Number.isInteger(diagnostic.httpStatus)&&diagnostic.httpStatus!>=400&&diagnostic.httpStatus!<=599?diagnostic.httpStatus:undefined;
      console.error(JSON.stringify({event:'file-release-check',status:'failed',code,step,detail,errorName,validationReason,httpStatus}));
      throw Error('FILE_RELEASE_CHECK_FAILED');
    }
  }
  await app.listen(Number(process.env.FILE_PORT??3105),process.env.SERVICE_BIND_HOST??'127.0.0.1');
  const publisher=await startOutboxPublisher('files',repository);
  let cleaning=false;
  const timer=setInterval(()=>{
    if(cleaning||process.env.FILE_STORAGE_PROVIDER!=='s3')return;cleaning=true;
    void repository.cleanupExpired().catch(()=>console.warn('files: expired-object cleanup will retry')).finally(()=>{cleaning=false;});
  },300000);timer.unref();
  bindEventingShutdown(repository,async()=>{clearInterval(timer);await publisher();});
  registerApplicationShutdown(app);
}
if(process.env.FILE_SKIP_BOOTSTRAP!=='true')void bootstrap();
