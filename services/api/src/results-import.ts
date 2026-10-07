import { BadRequestException } from '@nestjs/common';

export type ResultImportRow = {
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

const text = (value: unknown, maxLength: number) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export function parseResultImportRows(value: unknown): ResultImportRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    throw new BadRequestException({ code: 'RESULT_IMPORT_ROW_COUNT_INVALID', maximum: 200 });
  }
  const seen = new Set<string>();
  return value.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException({ code: 'RESULT_IMPORT_ROW_INVALID', row: index + 2 });
    const source = item as Record<string, unknown>;
    const admissionNumber = text(source.admissionNumber, 80).toUpperCase();
    const examName = text(source.examName, 150);
    const subjectName = text(source.subjectName, 100);
    const subjectCode = text(source.subjectCode, 60).toUpperCase() || undefined;
    const grade = text(source.grade, 24) || undefined;
    const remarks = text(source.remarks, 500) || undefined;
    const marksObtained = typeof source.marksObtained === 'number' ? source.marksObtained
      : typeof source.marksObtained === 'string' && source.marksObtained.trim() ? Number(source.marksObtained) : Number.NaN;
    const maxMarks = typeof source.maxMarks === 'number' ? source.maxMarks
      : typeof source.maxMarks === 'string' && source.maxMarks.trim() ? Number(source.maxMarks) : Number.NaN;
    const resultDate = text(source.resultDate, 10) || undefined;
    if (!/^[A-Z0-9_-]{1,80}$/.test(admissionNumber) || !examName || !subjectName ||
        !Number.isFinite(marksObtained) || !Number.isFinite(maxMarks) || marksObtained < 0 || maxMarks <= 0 ||
        marksObtained > maxMarks || Math.max(decimalPlaces(marksObtained), decimalPlaces(maxMarks)) > 2 ||
        (resultDate && !validIsoDate(resultDate))) {
      throw new BadRequestException({ code: 'RESULT_IMPORT_ROW_INVALID', row: index + 2 });
    }
    const uniqueKey = `${admissionNumber}\u0000${examName.toLocaleLowerCase()}\u0000${subjectName.toLocaleLowerCase()}`;
    if (seen.has(uniqueKey)) throw new BadRequestException({ code: 'RESULT_IMPORT_DUPLICATE_ROW', row: index + 2 });
    seen.add(uniqueKey);
    return { admissionNumber, examName, subjectName, subjectCode, marksObtained, maxMarks, grade, remarks, resultDate };
  });
}

function decimalPlaces(value: number) {
  const decimal = String(value).split('.')[1];
  return decimal?.length ?? 0;
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
