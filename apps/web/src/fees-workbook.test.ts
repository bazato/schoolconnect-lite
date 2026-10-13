import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFeesWorkbook } from './fees-workbook';
const fees=['admissionNumber','feeReference','academicYear','dueDate','amount','currency','description'];
const collections=['admissionNumber','feeReference','collectionReference','collectionDate','amount'];
function file(rows:unknown[][],receipts?:unknown[][]) {
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Fees');
  if(receipts) XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(receipts),'Collections');
  return new File([XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer],'fees.xlsx');
}
describe('fee Excel parsing', () => {
  it('preserves admission identifiers, decimal amounts and both sheets', async () => {
    const result=await parseFeesWorkbook(file([fees,['001','OCT','2026-27','2026-10-01','100.00','INR','Tuition']],[collections,['001','OCT','R-1','2026-10-05','20.00']]));
    expect(result.fees[0]).toMatchObject({admissionNumber:'001',amount:'100.00'});expect(result.collections[0].collectionReference).toBe('R-1');
  });
  it('accepts native Excel dates', async () => expect((await parseFeesWorkbook(file([fees,['001','OCT','2026-27',46296,100,'INR','']]))).fees[0].dueDate).toBe('2026-10-01'));
  it('rejects missing headers, formulas and more than 200 rows', async () => {
    await expect(parseFeesWorkbook(file([['admissionNumber'],['001']]))).rejects.toThrow('missing column');
    const wb=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet([fees,['001','OCT','2026-27','2026-10-01',1,'INR','']]);sheet.E2={t:'n',f:'1+1',v:2};XLSX.utils.book_append_sheet(wb,sheet,'Fees');
    await expect(parseFeesWorkbook(new File([XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer],'fees.xlsx'))).rejects.toThrow('formulas');
    await expect(parseFeesWorkbook(file([fees,...Array(201).fill(['001','OCT','2026-27','2026-10-01',100,'INR',''])]))).rejects.toThrow('200');
  });
  it('ships a valid two-sheet template with required text headers and no formulas', async () => {
    const bytes=await readFile(new URL('../public/nexqon-fees-template.xlsx',import.meta.url));
    const wb=XLSX.read(bytes,{type:'buffer'});expect(wb.SheetNames).toEqual(['Fees','Collections']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Fees,{header:1})[0]).toEqual(fees);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Collections,{header:1})[0]).toEqual(collections);
    for(const sheet of Object.values(wb.Sheets)) for(const cell of Object.values(sheet)) if(cell && typeof cell==='object') expect('f' in cell).toBe(false);
  });
});
