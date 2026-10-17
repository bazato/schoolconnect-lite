import { createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClamdScanner, HttpClamAvScanner, eicar, freshVersion } from './clamav';
const version=()=>`ClamAV 1.4.6/28000/${new Date().toUTCString()}`;
let server:Server|undefined;
afterEach(async()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();if(server){await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}});
async function fakeClamd(options:{infected?:boolean;stale?:boolean;brokenSelfTest?:boolean;hang?:boolean}={}){
  server=createServer(socket=>{
    let input=Buffer.alloc(0),sent=false;
    socket.on('data',chunk=>{
      input=Buffer.concat([input,chunk]);if(sent||options.hang)return;
      const separator=input.indexOf(0);if(separator<0)return;
      const command=input.subarray(0,separator).toString();
      if(command==='zVERSION'){sent=true;socket.end(`${options.stale?'ClamAV 1.4.6/123/Mon, 01 Jan 2024 00:00:00 GMT':version()}\0`);return;}
      expect(command).toBe('zINSTREAM');let offset=separator+1;const chunks:Buffer[]=[];
      for(;;){if(input.length<offset+4)return;const length=input.readUInt32BE(offset);offset+=4;if(!length)break;if(input.length<offset+length)return;chunks.push(input.subarray(offset,offset+length));offset+=length;}
      sent=true;const bytes=Buffer.concat(chunks);
      const infected=bytes.equals(eicar())?!options.brokenSelfTest:options.infected;
      socket.end(infected?'stream: Eicar-Test-Signature FOUND\0':'stream: OK\0');
    });
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  return new ClamdScanner('127.0.0.1',(server.address() as {port:number}).port,150);
}
describe('ClamAV protocol adapters (fake daemon, not a full-engine acceptance test)',()=>{
  it('uses the exact standard 68-byte EICAR health-test payload',()=>{expect(eicar().length).toBe(68);expect(createHash('sha256').update(eicar()).digest('hex')).toBe('275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f');});
  it('streams bytes and verifies the scanner detects its EICAR self-test',async()=>{const scanner=await fakeClamd();await expect(scanner.assertClean(Buffer.alloc(150000,17))).resolves.toMatch(/^ClamAV/);await expect(scanner.health()).resolves.toMatch(/^ClamAV/);});
  it('rejects infected bytes',async()=>{const scanner=await fakeClamd({infected:true});await expect(scanner.assertClean(Buffer.from('infected'))).rejects.toThrow('MALWARE_DETECTED');});
  it('fails closed for a pretend-clean engine',async()=>{const scanner=await fakeClamd({brokenSelfTest:true});await expect(scanner.assertClean(Buffer.from('x'))).rejects.toThrow('SCANNER_SELF_TEST_FAILED');});
  it('fails closed for stale definitions',async()=>{const scanner=await fakeClamd({stale:true});await expect(scanner.health()).rejects.toThrow('SCANNER_DEFINITIONS_STALE');});
  it('bounds unresponsive scanner calls',async()=>{const scanner=await fakeClamd({hang:true});await expect(scanner.health()).rejects.toThrow('SCANNER_TIMEOUT');});
  it.each([NaN,0,169])('rejects an invalid signature age %s',age=>{expect(()=>freshVersion(version(),age)).toThrow('SCANNER_CONFIG_INVALID');});
  it('forbids anonymous remote clamd TCP in production',()=>{vi.stubEnv('NODE_ENV','production');expect(()=>new ClamdScanner('public.example',3310)).toThrow('AUTHENTICATED_HTTPS');});
  it('requires HTTPS and a secret for remote scanning',()=>{expect(()=>new HttpClamAvScanner('http://public.example','x'.repeat(40))).toThrow();expect(()=>new HttpClamAvScanner('https://public.example','short')).toThrow();});
  it('sends bytes only to the configured authenticated gateway and checks its digest',async()=>{
    const bytes=Buffer.from('private-document'),fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({engine:'ClamAV',version:version(),verdict:'clean',sha256:createHash('sha256').update(bytes).digest('hex')})));
    vi.stubGlobal('fetch',fetch);await new HttpClamAvScanner('https://scanner.example','x'.repeat(40)).assertClean(bytes);
    expect(fetch).toHaveBeenCalledWith('https://scanner.example/v1/scan',expect.objectContaining({redirect:'error',headers:expect.objectContaining({authorization:`Bearer ${'x'.repeat(40)}`}),body:new Uint8Array(bytes)}));
  });
  it.each(['wrong-digest','unknown-verdict'])('fails closed for %s',async(reason)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({engine:'ClamAV',version:version(),verdict:reason==='unknown-verdict'?'unknown':'clean',sha256:reason==='wrong-digest'?'0'.repeat(64):createHash('sha256').update('x').digest('hex')}))));
    await expect(new HttpClamAvScanner('https://scanner.example','x'.repeat(40)).assertClean(Buffer.from('x'))).rejects.toThrow('SCANNER_ATTESTATION_INVALID');
  });
  it('bounds oversized scanner responses',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('x'.repeat(5000))));await expect(new HttpClamAvScanner('https://scanner.example','x'.repeat(40)).health()).rejects.toThrow('SCANNER_RESPONSE_INVALID');});
});
