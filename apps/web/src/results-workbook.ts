export type ResultRow = {
  admissionNumber: string;
  examName: string;
  subjectName: string;
  subjectCode?: string;
  marksObtained: number;
  maxMarks: number;
  grade?: string;
  remarks?: string;
  resultDate?: string;
};

const headers = ['admissionNumber', 'examName', 'subjectName', 'subjectCode', 'marksObtained', 'maxMarks', 'grade', 'remarks', 'resultDate'] as const;
const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const cellText = (value: unknown) => value === null || value === undefined ? '' : String(value).trim();

export async function parseResultsWorkbook(file: File): Promise<ResultRow[]> {
  const XLSX = await import('xlsx');
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('RESULT_WORKBOOK_SIZE_INVALID');
  const workbook = XLSX.read(await file.arrayBuffer(), { cellFormula: true, cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
  if (!firstSheet || !firstSheet['!ref']) throw new Error('RESULT_WORKBOOK_EMPTY');
  const range = XLSX.utils.decode_range(firstSheet['!ref']);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (firstSheet[address]?.f) throw new Error('RESULT_WORKBOOK_FORMULAS_UNSUPPORTED');
    }
  }
  const data = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '', raw: true, blankrows: false });
  const headerRow = data[0]?.map(normalizeHeader) ?? [];
  const columns = new Map(headerRow.map((name, index) => [name, index]));
  const required = ['admissionnumber', 'examname', 'subjectname', 'marksobtained', 'maxmarks'];
  if (required.some((name) => !columns.has(name))) throw new Error('RESULT_WORKBOOK_HEADER_INVALID');
  const rows = data.slice(1).filter((row) => row.some((cell) => cellText(cell) !== ''));
  if (!rows.length || rows.length > 200) throw new Error('RESULT_WORKBOOK_ROW_COUNT_INVALID');
  const values = (row: unknown[], header: string) => {
    const index = columns.get(header);
    return index === undefined ? '' : row[index];
  };
  const dateValue = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = XLSX.SSF.parse_date_code(value);
      if (!date) return '';
      return `${date.y.toString().padStart(4, '0')}-${date.m.toString().padStart(2, '0')}-${date.d.toString().padStart(2, '0')}`;
    }
    return cellText(value);
  };
  return rows.map((row, index) => {
    const marksObtained = Number(values(row, 'marksobtained'));
    const maxMarks = Number(values(row, 'maxmarks'));
    if (!Number.isFinite(marksObtained) || !Number.isFinite(maxMarks)) throw new Error(`RESULT_WORKBOOK_ROW_INVALID:${index + 2}`);
    return {
      admissionNumber: cellText(values(row, 'admissionnumber')).toUpperCase(),
      examName: cellText(values(row, 'examname')),
      subjectName: cellText(values(row, 'subjectname')),
      subjectCode: cellText(values(row, 'subjectcode')).toUpperCase() || undefined,
      marksObtained,
      maxMarks,
      grade: cellText(values(row, 'grade')) || undefined,
      remarks: cellText(values(row, 'remarks')) || undefined,
      resultDate: dateValue(values(row, 'resultdate')) || undefined,
    };
  });
}

export async function downloadResultsTemplate() {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([[...headers], ['', '', '', '', '', '', '', '', '']]);
  worksheet['!cols'] = headers.map((header) => ({ wch: Math.max(16, header.length + 3) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
  XLSX.writeFile(workbook, 'schoolconnect-results-template.xlsx');
}
