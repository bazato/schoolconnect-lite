import { describe, expect, it } from 'vitest';
import { parseResultsWorkbook } from './results-workbook';

const fileFrom = async (workbook: import('xlsx').WorkBook) => {
  const XLSX = await import('xlsx');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'results.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

describe('Excel result import', () => {
  it('parses a local spreadsheet into normalized result rows', async () => {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Admission Number', 'Exam Name', 'Subject Name', 'Subject Code', 'Marks Obtained', 'Max Marks', 'Grade', 'Remarks', 'Result Date'],
      ['a-001', 'Term 1', 'Mathematics', 'MATH', 82, 100, 'A', 'Good work', '2026-10-01'],
    ]), 'Results');
    await expect(parseResultsWorkbook(await fileFrom(workbook))).resolves.toEqual([{
      admissionNumber: 'A-001', examName: 'Term 1', subjectName: 'Mathematics', subjectCode: 'MATH',
      marksObtained: 82, maxMarks: 100, grade: 'A', remarks: 'Good work', resultDate: '2026-10-01',
    }]);
  });

  it('rejects workbooks with formulas and oversized result batches', async () => {
    const XLSX = await import('xlsx');
    const formulas = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([['admissionNumber', 'examName', 'subjectName', 'marksObtained', 'maxMarks'], ['A-1', 'Term 1', 'Math', 1, 10]]);
    worksheet.E2 = { t: 'n', f: '5+5', v: 10 };
    XLSX.utils.book_append_sheet(formulas, worksheet, 'Results');
    await expect(parseResultsWorkbook(await fileFrom(formulas))).rejects.toThrow('RESULT_WORKBOOK_FORMULAS_UNSUPPORTED');
  });
});
