import {createHash} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CloudmersiveScanner} from './cloudmersive';
const key='fixture-key-not-a-real-key-1234567890';
const fingerprint=createHash('sha256').update(key).digest('hex');
function budget(checked=true){
  let state={remaining:550,checkedAt:checked?new Date():null as Date|null,fingerprint:checked?fingerprint:null as string|null};
  return {status:vi.fn(async()=>state),acquire:vi.fn(async()=>{state={...state,remaining:state.remaining-1};return 'ticket';}),release:vi.fn(async()=>{}),verified:vi.fn(async(hash:string)=>{state={...state,checkedAt:new Date(),fingerprint:hash};}),close:vi.fn(async()=>{})};
}
const clean=()=>new Response(JSON.stringify({CleanResult:true,FoundViruses:[],ContainsScript:false}));
beforeEach(()=>{vi.stubEnv('FILE_SCANNER_ALLOW_EXTERNAL_PROCESSING','true');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Cloudmersive adapter (mock HTTP, no external documents sent)',()=>{
  it('requires a protected key and explicit external-processing approval',()=>{expect(()=>new CloudmersiveScanner('',budget())).toThrow('API_KEY_REQUIRED');vi.stubEnv('FILE_SCANNER_ALLOW_EXTERNAL_PROCESSING','false');expect(()=>new CloudmersiveScanner(key,budget())).toThrow('APPROVAL_REQUIRED');});
  it('scans exact compressed bytes at the fixed HTTPS origin with restrictive options',async()=>{
    const fetch=vi.fn().mockResolvedValue(clean());vi.stubGlobal('fetch',fetch);const gate=budget(),bytes=Buffer.from('%PDF-1.7\nexample\n%%EOF\n');
    await expect(new CloudmersiveScanner(key,gate).assertClean(bytes)).resolves.toMatch(/^Cloudmersive/);
    expect(fetch).toHaveBeenCalledOnce();const [url,input]=fetch.mock.calls[0];expect(url).toBe('https://api.cloudmersive.com/virus/scan/file/advanced');
    expect(input.redirect).toBe('error');expect(input.headers).toMatchObject({Apikey:key,allowScripts:'false',allowPasswordProtectedFiles:'false',restrictFileTypes:'.pdf,.png,.jpg,.jpeg'});
    const file=(input.body as FormData).get('inputFile') as File;expect(file.name).toBe('document.pdf');expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);expect(gate.release).toHaveBeenCalledOnce();
  });
  it('verifies both a clean PDF and actual EICAR detection before first use',async()=>{
    const fetch=vi.fn().mockImplementation(async(url:string)=>url.endsWith('/advanced')?clean():new Response(JSON.stringify({CleanResult:false,FoundViruses:[{VirusName:'Eicar-Test-Signature'}]})));vi.stubGlobal('fetch',fetch);const gate=budget(false),scanner=new CloudmersiveScanner(key,gate);
    await scanner.health();await scanner.health();expect(fetch).toHaveBeenCalledTimes(2);expect(gate.verified).toHaveBeenCalledWith(fingerprint);
  });
  it('rejects a pretend-clean remote service even if it accepts the clean control',async()=>{vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>clean()));await expect(new CloudmersiveScanner(key,budget(false)).health()).rejects.toThrow('SELF_TEST_FAILED');});
  it('accepts a null empty virus collection only for an explicit clean verdict',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({CleanResult:true,FoundViruses:null}))));
    await expect(new CloudmersiveScanner(key,budget()).assertClean(Buffer.from('file'))).resolves.toMatch(/^Cloudmersive/);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({CleanResult:false,FoundViruses:null}))));
    await expect(new CloudmersiveScanner(key,budget()).assertClean(Buffer.from('file'))).rejects.toThrow('INVALID_RESPONSE');
  });
  it.each([{CleanResult:false,FoundViruses:[{VirusName:'test'}]},{CleanResult:true,FoundViruses:[],ContainsScript:true}])('rejects detected malware or active content',async verdict=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(verdict))));await expect(new CloudmersiveScanner(key,budget()).assertClean(Buffer.from('file'))).rejects.toThrow('MALWARE_DETECTED');});
  it.each([{CleanResult:'true',FoundViruses:[]},{CleanResult:true},{CleanResult:true,FoundViruses:[],ContainsScript:'false'}])('fails closed for incomplete or malformed verdicts',async verdict=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(verdict))));await expect(new CloudmersiveScanner(key,budget()).assertClean(Buffer.from('file'))).rejects.toThrow('INVALID_RESPONSE');});
  it('never sends >3.4 MB to the provider or consumes its request allowance',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const gate=budget();await expect(new CloudmersiveScanner(key,gate).assertClean(Buffer.alloc(3_400_001))).rejects.toThrow('CANNOT_COMPRESS');expect(fetch).not.toHaveBeenCalled();expect(gate.acquire).not.toHaveBeenCalled();});
  it('treats provider quota exhaustion as unavailable and releases its lease',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:429})));const gate=budget();await expect(new CloudmersiveScanner(key,gate).assertClean(Buffer.from('x'))).rejects.toThrow('QUOTA_EXCEEDED');expect(gate.release).toHaveBeenCalledOnce();});
  it('does not call the provider when the durable budget is exhausted',async()=>{const gate=budget();gate.status.mockResolvedValue({remaining:0,checkedAt:new Date(),fingerprint});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(new CloudmersiveScanner(key,gate).health()).rejects.toThrow('QUOTA_EXCEEDED');expect(fetch).not.toHaveBeenCalled();});
});
