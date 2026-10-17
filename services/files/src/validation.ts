import { createHash } from 'node:crypto';
import { FileValidationError } from './clamav';
export function validateFileBytes(bytes:Buffer,expected:{byteSize:number;checksum:string;mediaType:string}) {
  if(bytes.length!==expected.byteSize)throw new FileValidationError('OBJECT_SIZE_MISMATCH');
  if(createHash('sha256').update(bytes).digest('hex')!==expected.checksum.toLowerCase())throw new FileValidationError('OBJECT_CHECKSUM_MISMATCH');
  let valid=false;
  if(expected.mediaType==='application/pdf')valid=/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(bytes.subarray(0,12).toString('ascii')) && /%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii'));
  if(expected.mediaType==='image/jpeg')valid=bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes.at(-2)===255 && bytes.at(-1)===217;
  if(expected.mediaType==='image/png')valid=bytes.length>=45 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12,16).toString()==='IHDR' && bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex'));
  if(!valid)throw new FileValidationError('FILE_CONTENT_TYPE_MISMATCH');
}
