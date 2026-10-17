import sharp from 'sharp';
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib';
import { deflateSync } from 'node:zlib';

export type PreparedDocument={bytes:Buffer;mediaType:string;method:string};
const tooLarge=()=>Error('FILE_CANNOT_COMPRESS_TO_LIMIT');

// Called only in a short-lived, heap/time-bounded child process for untrusted parsers.
export async function optimizeDocument(bytes:Buffer,mediaType:string,target:number):Promise<PreparedDocument>{
  if(mediaType==='application/pdf'){
    // Never rewrite signed documents: changing PDF bytes invalidates their signatures.
    const raw=bytes.toString('latin1');
    if(/\/ByteRange\b|\/Type\s*\/Sig\b|\/FT\s*\/Sig\b/.test(raw)){
      if(bytes.length>target)throw Error('FILE_SIGNED_PDF_TOO_LARGE');
      return {bytes,mediaType,method:'original'};
    }
    const document=await PDFDocument.load(bytes,{updateMetadata:false,ignoreEncryption:false,throwOnInvalidObject:true});
    // Signature fields may themselves be inside compressed PDF object streams.
    const pending:unknown[]=document.context.enumerateIndirectObjects().map(([,object])=>object),seen=new Set<unknown>();
    let signed=false;
    while(pending.length){
      const object=pending.pop();if(seen.has(object))continue;seen.add(object);
      if(seen.size>50000)throw Error('FILE_COMPRESSION_FAILED');
      if(object instanceof PDFDict){
        const fieldType=object.get(PDFName.of('FT')),type=object.get(PDFName.of('Type'));
        if(object.has(PDFName.of('ByteRange')) || (fieldType instanceof PDFName&&fieldType.decodeText()==='Sig') || (type instanceof PDFName&&type.decodeText()==='Sig')){signed=true;break;}
        pending.push(...object.values());
      }else if(object instanceof PDFArray)for(let index=0;index<object.size();index++)pending.push(object.get(index));
    }
    if(signed){if(bytes.length>target)throw Error('FILE_SIGNED_PDF_TOO_LARGE');return {bytes,mediaType,method:'original'};}
    if(document.getPageCount()>200)throw Error('FILE_PDF_TOO_MANY_PAGES');
    for(const [reference,object] of document.context.enumerateIndirectObjects()){
      if(object instanceof PDFRawStream&&!object.dict.has(PDFName.of('Filter'))){
        const contents=object.getContents(),compressed=deflateSync(contents);
        if(compressed.length<contents.length){
          const dictionary=object.dict.clone(document.context);dictionary.set(PDFName.of('Filter'),PDFName.of('FlateDecode'));dictionary.set(PDFName.of('Length'),PDFNumber.of(compressed.length));
          document.context.assign(reference,PDFRawStream.of(dictionary,compressed));
        }
      }
    }
    // Lossless PDF object-stream rewriting. No page rasterization or image/text quality reduction.
    const optimized=Buffer.from(await document.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false}));
    const result=optimized.length<bytes.length?optimized:bytes;
    if(result.length>target)throw tooLarge();
    return {bytes:result,mediaType,method:result===bytes?'original':'pdf-object-streams-v1'};
  }
  if(!['image/jpeg','image/png'].includes(mediaType))throw Error('FILE_CONTENT_TYPE_MISMATCH');
  sharp.cache(false);sharp.concurrency(1);
  const options={limitInputPixels:16_000_000,failOn:'warning' as const,sequentialRead:true};
  const metadata=await sharp(bytes,options).metadata();
  if(!metadata.width||!metadata.height||metadata.width*metadata.height>16_000_000||(metadata.pages??1)!==1)throw Error('FILE_IMAGE_DIMENSIONS_EXCEEDED');
  if(metadata.format!==(mediaType==='image/jpeg'?'jpeg':'png'))throw Error('FILE_CONTENT_TYPE_MISMATCH');
  let best=bytes;
  // Keep the format, alpha, EXIF orientation and all visible content. Strip ancillary metadata.
  // Stop at 1600px long-edge rather than silently making result sheets unreadable.
  for(const edge of [2400,2000,1600]){
    const image=sharp(bytes,options).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true});
    const result=await (mediaType==='image/jpeg'?image.jpeg({quality:88,mozjpeg:true}):image.png({compressionLevel:9,adaptiveFiltering:true})).toBuffer();
    if(result.length<best.length)best=result;
    if(best.length<=target)break;
  }
  if(best.length>target)throw tooLarge();
  return {bytes:best,mediaType,method:best===bytes?'original':'image-optimized-v1'};
}

if(process.send&&process.env.NEXQON_DOCUMENT_PROCESSOR==='true'){
  const send=(message:unknown)=>new Promise<void>((resolve,reject)=>process.send?.(message,(error:Error|null)=>error?reject(error):resolve()));
  process.once('message',async(message:{bytes:Uint8Array;mediaType:string;target:number})=>{
    try{
      const result=await optimizeDocument(Buffer.from(message.bytes),message.mediaType,message.target);
      await send({ok:true,...result});
    }catch(error){
      const code=error instanceof Error&&/^FILE_[A-Z_]+$/.test(error.message)?error.message:'FILE_COMPRESSION_FAILED';
      await send({ok:false,code}).catch(()=>undefined);
    }finally{if(process.connected)process.disconnect();}
  });
}
