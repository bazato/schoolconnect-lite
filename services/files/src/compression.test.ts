import {createHash,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {PDFDocument,PDFName,PDFString,PDFRawStream} from 'pdf-lib';
import {inflateSync} from 'node:zlib';
import {describe,expect,it} from 'vitest';
import {compressForStorage} from './compression';
import {optimizeDocument} from './compression-worker';
import {fileUploadPolicy} from './file-policy';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function bigPdf(incompressible=false){
  const doc=await PDFDocument.create();doc.setTitle('Student report');doc.addPage([595,842]);doc.addPage([595,842]);
  if(incompressible){doc.catalog.set(PDFName.of('ReportBinary'),doc.context.register(doc.context.flateStream(randomBytes(3_600_000))));}
  else{doc.catalog.set(PDFName.of('ReportNote'),PDFString.of('Original report text'));doc.catalog.set(PDFName.of('ReportData'),doc.context.register(doc.context.stream(Buffer.from('% result content padding\n'.repeat(150_000)))));}
  return Buffer.from(await doc.save({useObjectStreams:false,updateFieldAppearances:false}));
}
describe('5 MB original / 3.4 MB checked-storage pipeline',()=>{
  it('rejects >5 MB original bytes before starting a parser',async()=>{await expect(compressForStorage(Buffer.alloc(5_000_001),'application/pdf')).rejects.toThrow('FILE_TOO_LARGE');});
  it('preserves already small PDF bytes unchanged',async()=>{const bytes=Buffer.from('%PDF-1.7\nsmall\n%%EOF\n');const result=await compressForStorage(bytes,'application/pdf');expect(result.bytes).toEqual(bytes);expect(result.method).toBe('original');});
  it('losslessly rewrites a 3.4–5 MB PDF while preserving pages and report data',async()=>{
    const original=await bigPdf();expect(original.length).toBeGreaterThan(3_400_000);expect(original.length).toBeLessThanOrEqual(5_000_000);
    const result=await compressForStorage(original,'application/pdf');expect(result.bytes.length).toBeLessThanOrEqual(3_400_000);expect(result.method).toBe('pdf-object-streams-v1');
    const restored=await PDFDocument.load(result.bytes);expect(restored.getPageCount()).toBe(2);expect(restored.getTitle()).toBe('Student report');expect((restored.catalog.get(PDFName.of('ReportNote')) as PDFString).asString()).toBe('Original report text');
    const data=restored.context.lookup(restored.catalog.get(PDFName.of('ReportData'))!) as PDFRawStream;expect(inflateSync(data.getContents()).toString()).toBe('% result content padding\n'.repeat(150_000));
    expect(hash(result.bytes)).not.toBe(hash(original));
  },20000);
  it('rejects an incompressible <5 MB PDF instead of rasterizing/removing pages',async()=>{const bytes=await bigPdf(true);expect(bytes.length).toBeLessThanOrEqual(5_000_000);await expect(compressForStorage(bytes,'application/pdf')).rejects.toThrow('FILE_CANNOT_COMPRESS_TO_LIMIT');},20000);
  it('does not invalidate signed PDF bytes to fit the scanner limit',async()=>{
    const bytes=Buffer.from('%PDF-1.7\n/ByteRange [0 100 200 300]\n%%EOF\n');
    await expect(optimizeDocument(bytes,'application/pdf',10)).rejects.toThrow('FILE_SIGNED_PDF_TOO_LARGE');
    expect((await optimizeDocument(bytes,'application/pdf',1000)).bytes).toEqual(bytes);
  });
  it('also preserves signature markers hidden in compressed PDF objects',async()=>{
    const document=await PDFDocument.create();document.addPage();document.catalog.set(PDFName.of('SignedField'),document.context.obj({FT:'Sig',ByteRange:[0,1,2,3]}));
    const bytes=Buffer.from(await document.save({useObjectStreams:true}));expect(bytes.toString('latin1')).not.toMatch(/\/ByteRange\b|\/FT\s*\/Sig\b/);
    expect((await optimizeDocument(bytes,'application/pdf',bytes.length)).bytes).toEqual(bytes);
  });
  it('reduces a noisy 5 MB PNG in the isolated parser while retaining format and alpha',async()=>{
    const width=1800,height=580;
    const pixels=randomBytes(width*height*4);
    const bytes=await sharp(pixels,{raw:{width,height,channels:4}}).png({compressionLevel:0}).toBuffer();
    expect(bytes.length).toBeGreaterThan(3_400_000);expect(bytes.length).toBeLessThanOrEqual(5_000_000);
    const result=await compressForStorage(bytes,'image/png');const info=await sharp(result.bytes).metadata();
    expect(result.bytes.length).toBeLessThanOrEqual(3_400_000);expect(result.mediaType).toBe('image/png');expect(info.format).toBe('png');expect(info.hasAlpha).toBe(true);expect(info.width).toBeGreaterThanOrEqual(1600);expect(info.height).toBeGreaterThanOrEqual(515);
  },20000);
  it('re-encodes JPEG without enlarging or changing its media type',async()=>{
    const bytes=await sharp({create:{width:2000,height:1200,channels:3,background:'#ddd'}}).jpeg({quality:100}).toBuffer();
    const result=await compressForStorage(bytes,'image/jpeg');expect(result.mediaType).toBe('image/jpeg');expect(result.bytes.length).toBeLessThanOrEqual(bytes.length);expect((await sharp(result.bytes).metadata()).width).toBe(2000);
  },20000);
  it('fails closed for malformed images rather than storing the original unscanned',async()=>{await expect(compressForStorage(Buffer.from([255,216,255,1,255,217]),'image/jpeg')).rejects.toThrow('FILE_COMPRESSION_FAILED');},20000);
  it('bounds decompressed image dimensions even when the upload is tiny',async()=>{
    const bytes=await sharp({create:{width:5000,height:4000,channels:3,background:'#fff'}}).png().toBuffer();
    expect(bytes.length).toBeLessThan(fileUploadPolicy.maxByteSize);await expect(compressForStorage(bytes,'image/png')).rejects.toThrow('FILE_COMPRESSION_FAILED');
  },20000);
});
