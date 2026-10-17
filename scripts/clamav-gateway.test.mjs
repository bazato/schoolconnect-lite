import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createScannerGateway} from './clamav-gateway.mjs';
const token='t'.repeat(40),headers={authorization:`Bearer ${token}`,'content-type':'application/octet-stream'};
async function gateway(run,scanner={async health(){return `ClamAV 1.4.6/28000/${new Date().toUTCString()}`;},async assertClean(){}}){
  const server=createScannerGateway({scanner,token,maximum:100});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('scanner gateway refuses requests without its private token',()=>gateway(async url=>{assert.equal((await fetch(`${url}/health`)).status,401);}));
test('scanner gateway returns a clean attestation for the actual input bytes',()=>gateway(async url=>{const bytes=Buffer.from('test bytes');const result=await fetch(`${url}/v1/scan`,{method:'POST',headers,body:bytes});assert.equal(result.status,200);assert.equal((await result.json()).sha256,createHash('sha256').update(bytes).digest('hex'));}));
test('scanner gateway refuses unsupported body types and excessive lengths',()=>gateway(async url=>{assert.equal((await fetch(`${url}/v1/scan`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}'})).status,415);assert.equal((await fetch(`${url}/v1/scan`,{method:'POST',headers,body:Buffer.alloc(101)})).status,413);}));
test('scanner gateway fails closed for scanner outage',()=>gateway(async url=>{assert.equal((await fetch(`${url}/v1/scan`,{method:'POST',headers,body:'x'})).status,503);},{async health(){throw Error('outage');},async assertClean(){throw Error('outage');}}));
test('scanner gateway reports malware without disclosing internal diagnostics',()=>gateway(async url=>{const result=await fetch(`${url}/v1/scan`,{method:'POST',headers,body:'x'});assert.equal(result.status,422);assert.deepEqual(await result.json(),{code:'MALWARE_DETECTED'});},{async health(){return 'unused';},async assertClean(){throw Error('MALWARE_DETECTED');}}));
test('scanner gateway bounds scan concurrency',()=>{
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});
  return gateway(async url=>{const first=fetch(`${url}/v1/scan`,{method:'POST',headers,body:'one'});await waiting;assert.equal((await fetch(`${url}/v1/scan`,{method:'POST',headers,body:'two'})).status,503);release();assert.equal((await first).status,200);},{async health(){return `ClamAV 1.4.6/28000/${new Date().toUTCString()}`;},async assertClean(){await new Promise(resolve=>{release=resolve;entered();});}});
});
