import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireFiles=createRequire(new URL('../services/files/package.json',import.meta.url));

export function createScannerGateway({scanner,token,maximum=20*1024*1024}){
  if(typeof token!=='string'||token.trim()!==token||Buffer.byteLength(token)<32)throw Error('SCANNER_SECRET_REQUIRED');
  const expected=Buffer.from(`Bearer ${token}`);let scanning=false;
  return createServer(async(request,response)=>{
    response.setHeader('cache-control','no-store');response.setHeader('content-type','application/json');
    const reply=(status,body)=>{response.writeHead(status);response.end(JSON.stringify(body));};
    const received=Buffer.from(request.headers.authorization??'');
    if(received.length!==expected.length||!timingSafeEqual(received,expected)){reply(401,{code:'SCANNER_AUTHENTICATION_REQUIRED'});request.resume();return;}
    if(request.method==='GET'&&request.url==='/health'){
      try{reply(200,{engine:'ClamAV',version:await scanner.health()});}catch{reply(503,{code:'SCANNER_UNAVAILABLE'});}return;
    }
    if(request.method!=='POST'||request.url!=='/v1/scan'){reply(404,{code:'NOT_FOUND'});request.resume();return;}
    if(request.headers['content-type']!=='application/octet-stream'){reply(415,{code:'SCANNER_CONTENT_TYPE_REQUIRED'});request.resume();return;}
    if(scanning){reply(503,{code:'SCANNER_BUSY'});request.resume();return;}
    if(Number(request.headers['content-length']??0)>maximum){reply(413,{code:'FILE_TOO_LARGE'});request.resume();return;}
    scanning=true;
    const deadline=setTimeout(()=>request.destroy(),60000);
    try{
      const chunks=[];let length=0;
      for await(const chunk of request){length+=chunk.length;if(length>maximum){reply(413,{code:'FILE_TOO_LARGE'});return;}chunks.push(chunk);}
      if(length<1){reply(400,{code:'EMPTY_FILE'});return;}
      const bytes=Buffer.concat(chunks,length);
      const version=await scanner.assertClean(bytes);
      reply(200,{engine:'ClamAV',version,verdict:'clean',sha256:createHash('sha256').update(bytes).digest('hex')});
    }catch(error){if(!response.writableEnded)reply(error?.message==='MALWARE_DETECTED'?422:503,{code:error?.message==='MALWARE_DETECTED'?'MALWARE_DETECTED':'SCANNER_UNAVAILABLE'});}
    finally{clearTimeout(deadline);scanning=false;}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {ClamdScanner}=requireFiles('./dist/clamav.js');
  const server=createScannerGateway({scanner:new ClamdScanner(),token:process.env.FILE_SCANNER_TOKEN});
  server.requestTimeout=65000;server.headersTimeout=10000;server.maxHeadersCount=30;
  const port=Number(process.env.FILE_SCANNER_GATEWAY_PORT??3311);
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('SCANNER_PORT_INVALID');
  server.listen(port,'127.0.0.1',()=>console.log('Private scanner gateway listening on loopback. No document contents are logged.'));
  const stop=()=>server.close(()=>process.exit());process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
