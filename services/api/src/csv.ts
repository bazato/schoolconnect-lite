import { BadRequestException } from '@nestjs/common';

export type StudentImportRow = {
  studentDisplayName: string;
  admissionNumber: string;
  classCode: string;
  parentDisplayName: string;
  parentPhoneE164: string;
  relationship: string;
};

const fields = ['studentDisplayName','admissionNumber','classCode','parentDisplayName','parentPhoneE164','relationship'];

export function parseStudentCsv(csv: string): StudentImportRow[] {
  if (typeof csv !== 'string' || csv.length > 1_000_000) throw new BadRequestException({ code: 'CSV_SIZE_INVALID' });
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = csv.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (quoted || !cell) quoted = !quoted;
      else throw new BadRequestException({ code: 'CSV_QUOTE_INVALID' });
    } else if (!quoted && character === ',') { row.push(cell.trim()); cell = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) table.push(row);
      row = [];
    } else cell += character;
  }
  if (quoted) throw new BadRequestException({ code: 'CSV_QUOTE_INVALID' });
  row.push(cell.trim());
  if (row.some(Boolean)) table.push(row);
  const header = table.shift();
  if (!header || fields.some((field, index) => header[index] !== field) || header.length !== fields.length) throw new BadRequestException({ code: 'CSV_HEADER_INVALID', expected: fields });
  if (!table.length || table.length > 200) throw new BadRequestException({ code: 'CSV_ROW_COUNT_INVALID' });
  const seen = new Set<string>();
  return table.map((values, index) => {
    if (values.length !== fields.length) throw new BadRequestException({ code: 'CSV_COLUMN_COUNT_INVALID', row: index + 2 });
    const [studentDisplayName, admissionNumber, classCode, parentDisplayName, parentPhoneE164, relationship] = values;
    if (!studentDisplayName || !/^[A-Z0-9_-]{1,80}$/i.test(admissionNumber!) || !classCode || !parentDisplayName || !/^\+[1-9]\d{7,14}$/.test(parentPhoneE164!)) {
      throw new BadRequestException({ code: 'CSV_ROW_INVALID', row: index + 2 });
    }
    const key = admissionNumber!.toUpperCase();
    if (seen.has(key)) throw new BadRequestException({ code: 'CSV_DUPLICATE_ADMISSION_NUMBER', row: index + 2 });
    seen.add(key);
    return { studentDisplayName: studentDisplayName!, admissionNumber: key, classCode: classCode!.toUpperCase(), parentDisplayName: parentDisplayName!, parentPhoneE164: parentPhoneE164!, relationship: relationship || 'Parent' };
  });
}
