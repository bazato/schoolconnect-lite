import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
export class FileValidationError extends Error {}
export interface MalwareScanner { assertClean(bytes:Buffer):Promise<string>; health():Promise<string>;close?():Promise<void> }
export const eicar=()=>Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
export function freshVersion(version:string,maxAgeHours=72) {
  if(!Number.isSafeInteger(maxAgeHours)||maxAgeHours<1||maxAgeHours>168)throw Error('SCANNER_CONFIG_INVALID');
  const parts=version.split('/');const timestamp=Date.parse(parts.slice(2).join('/'));
  if(!/^ClamAV \d+\.\d+\.\d+/.test(version) || !/^\d+$/.test(parts[1] ?? '') || !Number.isFinite(timestamp) || timestamp>Date.now()+3600000 || Date.now()-timestamp>maxAgeHours*3600000)throw Error('SCANNER_DEFINITIONS_STALE');
  return version;
}
export class ClamdScanner implements MalwareScanner {
  private checkedAt=0;private version='';
  constructor(private readonly host=process.env.CLAMAV_HOST ?? '127.0.0.1',private readonly port=Number(process.env.CLAMAV_PORT ?? 3310),private readonly timeout=Number(process.env.FILE_SCAN_TIMEOUT_MS ?? 40000)) {
    if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(timeout)||timeout<100||timeout>60000)throw Error('SCANNER_CONFIG_INVALID');
    if(process.env.NODE_ENV==='production' && !['127.0.0.1','localhost','::1','clamav'].includes(host))throw Error('REMOTE_CLAMD_REQUIRES_AUTHENTICATED_HTTPS_GATEWAY');
  }
  private command(command:string,bytes?:Buffer):Promise<string> {
    return new Promise((resolve,reject)=>{
      const socket=createConnection({host:this.host,port:this.port});let output=Buffer.alloc(0),settled=false;
      const end=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(deadline);socket.destroy();if(error)reject(error);else resolve(output.toString('utf8').replace(/\0.*$/s,'').trim());};
      const deadline=setTimeout(()=>end(Error('SCANNER_TIMEOUT')),this.timeout);
      socket.on('error',()=>end(Error('SCANNER_UNAVAILABLE')));socket.on('end',()=>end(Error('SCANNER_RESPONSE_TRUNCATED')));
      socket.on('data',(data)=>{output=Buffer.concat([output,data]);if(output.length>4096)return end(Error('SCANNER_RESPONSE_INVALID'));if(output.includes(0))end();});
      socket.once('connect',()=>{
        socket.write(`z${command}\0`);
        if(!bytes)return;
        // All bytes are bounded by the file policy. Clamd's INSTREAM protocol is length-prefixed.
        for(let offset=0;offset<bytes.length;offset+=65536){const chunk=bytes.subarray(offset,offset+65536),length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);socket.write(length);socket.write(chunk);}
        socket.write(Buffer.alloc(4));
      });
    });
  }
  async health() {
    if(Date.now()-this.checkedAt<30000)return this.version;
    const version=freshVersion(await this.command('VERSION'),Number(process.env.FILE_SIGNATURE_MAX_AGE_HOURS ?? 72));
    const test=await this.command('INSTREAM',eicar());
    if(!/^stream: .+ FOUND$/.test(test))throw Error('SCANNER_SELF_TEST_FAILED');
    this.version=version;this.checkedAt=Date.now();return version;
  }
  async assertClean(bytes:Buffer) {
    const version=await this.health();const result=await this.command('INSTREAM',bytes);
    if(result==='stream: OK')return version;
    if(/^stream: .+ FOUND$/.test(result))throw new FileValidationError('MALWARE_DETECTED');
    throw Error('SCANNER_FAILED_CLOSED');
  }
}
export class HttpClamAvScanner implements MalwareScanner {
  constructor(private readonly url=process.env.FILE_SCANNER_URL ?? '',private readonly token=process.env.FILE_SCANNER_TOKEN ?? '') {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.search || parsed.hash || token.length<32)throw Error('SCANNER_HTTPS_AND_SECRET_REQUIRED');
  }
  private async call(path:string,bytes?:Buffer) {
    const response=await fetch(`${this.url.replace(/\/$/,'')}${path}`,{method:bytes ? 'POST' : 'GET',redirect:'error',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/octet-stream'},body:bytes ? new Uint8Array(bytes) : undefined,signal:AbortSignal.timeout(Number(process.env.FILE_SCAN_TIMEOUT_MS ?? 40000))});
    const reader=response.body?.getReader();if(!reader)throw Error('SCANNER_RESPONSE_INVALID');
    let raw='';const decoder=new TextDecoder();let size=0;
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>4096){await reader.cancel();throw Error('SCANNER_RESPONSE_INVALID');}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
    const result=JSON.parse(raw) as {engine?:string;version?:string;sha256?:string;verdict?:string;code?:string};
    if(response.status===422 && result.code==='MALWARE_DETECTED')throw new FileValidationError('MALWARE_DETECTED');
    if(!response.ok || result.engine!=='ClamAV' || typeof result.version!=='string')throw Error('SCANNER_UNAVAILABLE');
    freshVersion(result.version,Number(process.env.FILE_SIGNATURE_MAX_AGE_HOURS ?? 72));return result;
  }
  async health(){const result=await this.call('/health');return result.version!;}
  async assertClean(bytes:Buffer){const result=await this.call('/v1/scan',bytes);if(result.verdict!=='clean' || result.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('SCANNER_ATTESTATION_INVALID');return result.version!;}
}
