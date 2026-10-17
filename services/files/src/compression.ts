import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { FileValidationError } from './clamav';
import { fileUploadPolicy } from './file-policy';
import type { PreparedDocument } from './compression-worker';

export async function compressForStorage(bytes:Buffer,mediaType:string):Promise<PreparedDocument>{
  if(bytes.length>fileUploadPolicy.maxByteSize)throw new FileValidationError('FILE_TOO_LARGE');
  const target=fileUploadPolicy.maxStoredByteSize;
  // Small PDFs are already comfortably within scanner limits; preserve their original bytes.
  if(mediaType==='application/pdf'&&bytes.length<=250_000)return {bytes,mediaType,method:'original'};
  return new Promise((resolveResult,reject)=>{
    // No database, R2 or scanner credentials are inherited by the untrusted document parser.
    const child=fork(resolve(__dirname,'../dist/compression-worker.js'),[],{serialization:'advanced',execArgv:['--max-old-space-size=96'],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:'production',NEXQON_DOCUMENT_PROCESSOR:'true'}});
    let settled=false;
    const finish=(error?:Error,result?:PreparedDocument)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();if(error)reject(error);else resolveResult(result!);};
    const timer=setTimeout(()=>finish(new FileValidationError('FILE_COMPRESSION_FAILED')),20000);
    child.once('error',()=>finish(new FileValidationError('FILE_COMPRESSION_FAILED')));
    child.once('exit',()=>finish(new FileValidationError('FILE_COMPRESSION_FAILED')));
    child.once('message',(message:{ok?:boolean;bytes?:Uint8Array;mediaType?:string;method?:string;code?:string})=>{
      if(!message.ok)return finish(new FileValidationError(message.code??'FILE_COMPRESSION_FAILED'));
      if(!(message.bytes instanceof Uint8Array)||message.bytes.length<1||message.bytes.length>target||message.bytes.length>bytes.length||message.mediaType!==mediaType)return finish(new FileValidationError('FILE_COMPRESSION_FAILED'));
      finish(undefined,{bytes:Buffer.from(message.bytes),mediaType,method:message.method??'original'});
    });
    child.send({bytes,mediaType,target},error=>{if(error)finish(new FileValidationError('FILE_COMPRESSION_FAILED'));});
  });
}
