import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {FileValidationError,eicar,type MalwareScanner} from './clamav';
import {fileUploadPolicy} from './file-policy';
import {PgScannerBudget,type ScannerBudget} from './scanner-budget';
type Verdict={CleanResult?:boolean;FoundViruses?:Array<{VirusName?:string}>|null;[key:string]:unknown};
const dangerousFlags=['ContainsExecutable','ContainsInvalidFile','ContainsScript','ContainsPasswordProtectedFile','ContainsMacros','ContainsXmlExternalEntities','ContainsInsecureDeserialization','ContainsHtml','ContainsUnsafeArchive','ContainsOleEmbeddedObject','ContainsUnwantedAction','ContainsRestrictedFileFormat'];
export class CloudmersiveScanner implements MalwareScanner {
  private pendingHealth:Promise<string>|undefined;
  constructor(private readonly key=process.env.CLOUDMERSIVE_API_KEY??'',private readonly budget:ScannerBudget=new PgScannerBudget()){
    if(key.length<20||key.trim()!==key)throw Error('CLOUDMERSIVE_API_KEY_REQUIRED');
    if(process.env.FILE_SCANNER_ALLOW_EXTERNAL_PROCESSING!=='true')throw Error('FILE_SCANNER_EXTERNAL_PROCESSING_APPROVAL_REQUIRED');
  }
  private async call(bytes:Buffer,fileName:string,advanced:boolean):Promise<Verdict>{
    if(bytes.length>fileUploadPolicy.maxStoredByteSize)throw new FileValidationError('FILE_CANNOT_COMPRESS_TO_LIMIT');
    let ticket:string|undefined;
    try{
      // One short spacing retry; concurrent requests do not form an unbounded in-memory queue.
      try{ticket=await this.budget.acquire();}catch(error){if(!(error instanceof Error)||error.message!=='FILE_SCANNER_BUSY')throw error;await new Promise(resolve=>setTimeout(resolve,1150));ticket=await this.budget.acquire();}
      const body=new FormData();body.append('inputFile',new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'}),fileName);
      const headers:Record<string,string>={Apikey:this.key};
      if(advanced){
        for(const name of ['allowExecutables','allowInvalidFiles','allowScripts','allowPasswordProtectedFiles','allowMacros','allowXmlExternalEntities','allowInsecureDeserialization','allowHtml','allowUnsafeArchives','allowOleEmbeddedObject','allowUnwantedAction'])headers[name]='false';
        headers.restrictFileTypes='.pdf,.png,.jpg,.jpeg';
      }
      // Fixed official origin, no redirects, no presigned R2 URLs or school/person names sent.
      const response=await fetch(`https://api.cloudmersive.com/virus/scan/file${advanced?'/advanced':''}`,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(40000)});
      if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'FILE_SCANNER_QUOTA_EXCEEDED':'FILE_SCANNER_UNAVAILABLE');}
      const reader=response.body?.getReader();if(!reader)throw Error('FILE_SCANNER_INVALID_RESPONSE');
      let raw='';let size=0;const decoder=new TextDecoder();
      try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>65536){await reader.cancel();throw Error('FILE_SCANNER_INVALID_RESPONSE');}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
      const invalid=(reason:string)=>Object.assign(Error('FILE_SCANNER_INVALID_RESPONSE'),{validationReason:reason});
      let result:Verdict;try{result=JSON.parse(raw) as Verdict;}catch{throw invalid('invalid_json');}
      if(!result||typeof result.CleanResult!=='boolean')throw invalid('invalid_clean_verdict');
      // The hosted API may serialize an empty optional virus collection as null.
      // Accept it ONLY alongside an explicit clean verdict; the EICAR control still requires a named detection.
      if(result.CleanResult===true&&result.FoundViruses===null)result.FoundViruses=[];
      if(!Array.isArray(result.FoundViruses))throw invalid('invalid_virus_collection');
      if(dangerousFlags.some(flag=>result[flag]!==undefined&&typeof result[flag]!=='boolean'))throw invalid('invalid_threat_flag');
      return result;
    }finally{if(ticket)await this.budget.release(ticket);}
  }
  async health(){
    const state=await this.budget.status(),fingerprint=createHash('sha256').update(this.key).digest('hex');
    if(state.remaining<1)throw Error('FILE_SCANNER_QUOTA_EXCEEDED');
    if(state.fingerprint===fingerprint&&state.checkedAt&&state.checkedAt.getTime()>Date.now()-86400000)return `Cloudmersive advanced API v1; verified ${state.checkedAt.toISOString()}`;
    if(this.pendingHealth)return this.pendingHealth;
    this.pendingHealth=(async()=>{
      if(state.remaining<3)throw Error('FILE_SCANNER_QUOTA_EXCEEDED');
      const document=await PDFDocument.create();document.addPage();
      const clean=await this.call(Buffer.from(await document.save()),'health-check.pdf',true);
      if(!clean.CleanResult||clean.FoundViruses!.length||dangerousFlags.some(flag=>clean[flag]===true))throw Error('FILE_SCANNER_SELF_TEST_FAILED');
      const infected=await this.call(eicar(),'eicar-test.txt',false);
      if(infected.CleanResult||!infected.FoundViruses!.some(virus=>typeof virus.VirusName==='string'&&/eicar/i.test(virus.VirusName)))throw Error('FILE_SCANNER_SELF_TEST_FAILED');
      await this.budget.verified(fingerprint);return `Cloudmersive advanced API v1; verified ${new Date().toISOString()}`;
    })();
    try{return await this.pendingHealth;}finally{this.pendingHealth=undefined;}
  }
  async assertClean(bytes:Buffer){
    if(bytes.length>fileUploadPolicy.maxStoredByteSize)throw new FileValidationError('FILE_CANNOT_COMPRESS_TO_LIMIT');
    const version=await this.health();
    const extension=bytes.subarray(0,5).toString()==='%PDF-'?'pdf':bytes[0]===137?'png':'jpg';
    const result=await this.call(bytes,`document.${extension}`,true);
    if(!result.CleanResult||result.FoundViruses!.length||dangerousFlags.some(flag=>result[flag]===true))throw new FileValidationError('MALWARE_DETECTED');
    return version;
  }
  async close(){await this.budget.close();}
}
