import {createHash,randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {compressForStorage} from './compression';
import {validateFileBytes} from './validation';
import type {MalwareScanner,PrivateObjectStorage} from './storage';

// Operator-enabled release check. No user data, business rows, secrets or signed URLs are logged.
// Only the two exact freshly generated synthetic keys can be removed.
export async function runFileReleaseCheck(storage:PrivateObjectStorage,scanner:MalwareScanner,http:typeof fetch=fetch){
  const prefix=`__nexqon_release_check__/${randomUUID()}/`,quarantine=`${prefix}quarantine.pdf`,ready=`${prefix}private.pdf`;
  const document=await PDFDocument.create();document.addPage().drawText('Nexqon synthetic upload acceptance check');
  const input=Buffer.from(await document.save()),checksum=createHash('sha256').update(input).digest('hex');
  const attempted=new Set<string>(),checks:string[]=[];
  const request=(url:string,init:RequestInit={})=>http(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
  let failure:unknown;
  try{
    await scanner.health();checks.push('clean_and_eicar_scanner_health');
    const url=await storage.createUploadUrl(quarantine,'application/pdf',input.length,checksum);
    const headers={'content-type':'application/pdf','if-none-match':'*','x-amz-meta-checksumsha256':checksum};
    attempted.add(quarantine);
    const uploaded=await request(url,{method:'PUT',headers,body:new Uint8Array(input)});
    await uploaded.body?.cancel();if(!uploaded.ok)throw Error('RELEASE_PRESIGNED_UPLOAD_FAILED');checks.push('presigned_upload');
    const duplicate=await request(url,{method:'PUT',headers,body:new Uint8Array(input)});
    await duplicate.body?.cancel();if(duplicate.status!==412)throw Error('RELEASE_CREATE_ONLY_NOT_ENFORCED');checks.push('create_only_upload');
    const bytes=await storage.read(quarantine,input.length);
    validateFileBytes(bytes,{byteSize:input.length,checksum,mediaType:'application/pdf'});
    const prepared=await compressForStorage(bytes,'application/pdf'),storedHash=createHash('sha256').update(prepared.bytes).digest('hex');
    await scanner.assertClean(prepared.bytes);checks.push('actual_final_bytes_scanned');
    attempted.add(ready);await storage.putChecked(ready,prepared.bytes,prepared.mediaType,storedHash);
    if(!(await storage.read(ready,prepared.bytes.length)).equals(prepared.bytes))throw Error('RELEASE_STORED_BYTES_MISMATCH');checks.push('immutable_checked_storage');
    const downloadUrl=await storage.createDownloadUrl(ready),download=await request(downloadUrl);
    if(!download.ok||!Buffer.from(await download.arrayBuffer()).equals(prepared.bytes))throw Error('RELEASE_DOWNLOAD_FAILED');checks.push('signed_private_download');
    const unsigned=new URL(downloadUrl);unsigned.search='';
    const denied=await request(unsigned.toString());await denied.body?.cancel();
    if(![400,401,403,404].includes(denied.status))throw Error('RELEASE_ANONYMOUS_ACCESS_NOT_DENIED');checks.push('unsigned_s3_access_denied');
  }catch(error){failure=error;}
  finally{for(const key of attempted){try{await storage.remove(key);}catch{failure=Error('RELEASE_SYNTHETIC_CLEANUP_FAILED');}}}
  if(failure)throw failure;
  checks.push('synthetic_objects_removed');return {status:'passed',checks};
}
