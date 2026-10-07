import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseResultImportRows } from './results-import';

describe('school result spreadsheet validation', () => {
  const validRow = { admissionNumber: 'A-001', examName: 'Term 1', subjectName: 'Mathematics', marksObtained: 82.5, maxMarks: 100, grade: 'A' };
  const expectErrorCode = (run: () => unknown, code: string) => {
    let error: unknown;
    try { run(); } catch (failure) { error = failure; }
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code });
  };

  it('normalizes admissions and preserves valid result fields', () => {
    expect(parseResultImportRows([{ ...validRow, admissionNumber: ' a-001 ' }])).toEqual([{ ...validRow, admissionNumber: 'A-001', subjectCode: undefined, remarks: undefined, resultDate: undefined }]);
  });

  it('rejects missing, excessive, duplicate, or impossible marks rows', () => {
    expectErrorCode(() => parseResultImportRows([]), 'RESULT_IMPORT_ROW_COUNT_INVALID');
    expectErrorCode(() => parseResultImportRows([{ ...validRow, marksObtained: 101 }]), 'RESULT_IMPORT_ROW_INVALID');
    expectErrorCode(() => parseResultImportRows([validRow, validRow]), 'RESULT_IMPORT_DUPLICATE_ROW');
    expectErrorCode(() => parseResultImportRows([{ ...validRow, marksObtained: 1.234 }]), 'RESULT_IMPORT_ROW_INVALID');
  });
});
