import { parseFeeImport, type FeeImport } from '@schoolconnect/contracts';

const columns = {
  Fees: ['admissionNumber','feeReference','academicYear','dueDate','amount','currency','description'],
  Collections: ['admissionNumber','feeReference','collectionReference','collectionDate','amount'],
} as const;

export async function parseFeesWorkbook(file: File): Promise<FeeImport> {
  if (!file.name.toLowerCase().endsWith('.xlsx') || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose an .xlsx workbook smaller than 5 MB.');
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { cellFormula:true,cellDates:false,sheetRows:202 });
  const data: { fees: Record<string,string | number>[]; collections: Record<string,string | number>[] } = { fees:[],collections:[] };
  for (const name of workbook.SheetNames) {
    if (name !== 'Fees' && name !== 'Collections') throw new Error('The workbook must contain only sheets named Fees and/or Collections.');
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref']);
    if (range.s.r !== 0 || range.s.c !== 0 || range.e.r > 200 || range.e.c > 15) throw new Error(`${name}: use at most 200 data rows and 16 columns, with headers in row 1.`);
    for (const [address,cell] of Object.entries(sheet)) { if (!address.startsWith('!') && cell && typeof cell === 'object' && 'f' in cell) throw new Error(`${name}: formulas are not accepted. Paste values only.`); }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet,{ header:1,raw:true,defval:'',blankrows:true });
    const normalize = (text: unknown) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
    const headers = (rows[0] ?? []).map(normalize), expected = columns[name];
    if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) throw new Error(`${name}: duplicate column headers.`);
    for (const column of expected.filter((column) => column !== 'description')) if (!headers.includes(normalize(column))) throw new Error(`${name}: missing column ${column}. Download the template.`);
    const parsed = rows.slice(1).map((row,index) => ({row,sourceRow:index+2})).filter(({row}) => row.some((value) => String(value ?? '').trim())).map(({row,sourceRow}) => {
      const record: Record<string,string | number> = {sourceRow};
      for (const column of expected) {
        const value = row[headers.indexOf(normalize(column))] ?? '';
        if ((column === 'dueDate' || column === 'collectionDate') && typeof value === 'number') {
          const date = XLSX.SSF.parse_date_code(value,{ date1904:workbook.Workbook?.WBProps?.date1904 });
          record[column] = date ? `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}` : '';
        } else record[column] = String(value).trim();
      }
      return record;
    });
    data[name === 'Fees' ? 'fees' : 'collections'] = parsed;
  }
  return parseFeeImport(data);
}
