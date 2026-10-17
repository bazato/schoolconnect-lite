import {describe,expect,it,vi} from 'vitest';
import {runFileReleaseCheck} from './release-check';
vi.mock('./compression',()=>({compressForStorage:async(bytes:Buffer)=>({bytes,mediaType:'application/pdf',method:'original'})}));
function fixture(publicRead=false){
  const objects=new Map<string,Buffer>();
  const storage={
    createUploadUrl:vi.fn(async(key:string)=>`https://storage.test/${key}?signed=put`),
    createDownloadUrl:vi.fn(async(key:string)=>`https://storage.test/${key}?signed=get`),
    read:vi.fn(async(key:string)=>Buffer.from(objects.get(key)!)),
    putChecked:vi.fn(async(key:string,bytes:Buffer)=>{objects.set(key,Buffer.from(bytes));}),
    remove:vi.fn(async(key:string)=>{objects.delete(key);}),
  };
  const scanner={health:vi.fn(async()=>'verified'),assertClean:vi.fn(async(bytes:Buffer)=>{expect(bytes.length).toBeGreaterThan(0);return 'verified';})};
  const http=vi.fn(async(url:string,init:RequestInit)=>{
    const target=new URL(url),key=target.pathname.slice(1);
    if(init.method==='PUT'){
      if(objects.has(key))return new Response(null,{status:412});
      objects.set(key,Buffer.from(init.body as Uint8Array));return new Response(null,{status:200});
    }
    if(!target.search&&!publicRead)return new Response(null,{status:403});
    return new Response(new Uint8Array(objects.get(key)!));
  });
  return {storage,scanner,http,objects};
}
describe('operator release acceptance check (storage and scanner test doubles)',()=>{
  it('checks signed PUT, replay denial, exact scanned bytes, download and anonymous denial then removes only synthetic keys',async()=>{
    const {storage,scanner,http,objects}=fixture();
    const result=await runFileReleaseCheck(storage,scanner,http as unknown as typeof fetch);
    expect(result.status).toBe('passed');expect(result.checks).toHaveLength(8);
    expect(scanner.assertClean.mock.calls[0]?.[0]).toEqual(storage.putChecked.mock.calls[0]?.[1]);
    expect(objects.size).toBe(0);expect(storage.remove).toHaveBeenCalledTimes(2);
    for(const [key] of storage.remove.mock.calls)expect(key).toMatch(/^__nexqon_release_check__\/[a-f0-9-]{36}\/(quarantine|private)\.pdf$/);
  });
  it('rejects unsigned access and still removes its own objects',async()=>{
    const {storage,scanner,http,objects}=fixture(true);
    await expect(runFileReleaseCheck(storage,scanner,http as unknown as typeof fetch)).rejects.toThrow('ANONYMOUS_ACCESS_NOT_DENIED');expect(objects.size).toBe(0);
  });
  it('never promotes bytes when scanning fails and cleans the uploaded synthetic source',async()=>{
    const {storage,scanner,http,objects}=fixture();scanner.assertClean.mockRejectedValue(Error('FILE_SCANNER_UNAVAILABLE'));
    await expect(runFileReleaseCheck(storage,scanner,http as unknown as typeof fetch)).rejects.toThrow('SCANNER_UNAVAILABLE');expect(storage.putChecked).not.toHaveBeenCalled();expect(objects.size).toBe(0);
  });
});
