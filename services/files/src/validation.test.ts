import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {validateFileBytes} from './validation';
const pdf=Buffer.from('%PDF-1.7\nexample\n%%EOF\n');
const metadata=(bytes:Buffer,mediaType='application/pdf')=>({byteSize:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex'),mediaType});
describe('server-side byte validation',()=>{
  it('checks the hash, actual length and declared file signature',()=>{expect(()=>validateFileBytes(pdf,metadata(pdf))).not.toThrow();});
  it('rejects a false declared length',()=>{expect(()=>validateFileBytes(pdf,{...metadata(pdf),byteSize:pdf.length+1})).toThrow('SIZE_MISMATCH');});
  it('rejects substituted bytes despite matching object metadata',()=>{expect(()=>validateFileBytes(pdf,{...metadata(pdf),checksum:'0'.repeat(64)})).toThrow('CHECKSUM_MISMATCH');});
  it('rejects an executable renamed as a PDF',()=>{const bytes=Buffer.from('MZ executable');expect(()=>validateFileBytes(bytes,metadata(bytes))).toThrow('CONTENT_TYPE_MISMATCH');});
  it('rejects truncated PDF data',()=>{const bytes=pdf.subarray(0,12);expect(()=>validateFileBytes(bytes,metadata(bytes))).toThrow('CONTENT_TYPE_MISMATCH');});
  it('does not allow a PDF to masquerade as a PNG',()=>{expect(()=>validateFileBytes(pdf,metadata(pdf,'image/png'))).toThrow('CONTENT_TYPE_MISMATCH');});
  it('recognizes a PNG header and end marker',()=>{const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000049454e44ae426082','hex');expect(()=>validateFileBytes(png,metadata(png,'image/png'))).not.toThrow();});
});
