import { describe, expect, it } from 'vitest';
import { parseStudentCsv } from './csv';

const header = 'studentDisplayName,admissionNumber,classCode,parentDisplayName,parentPhoneE164,relationship';

describe('student CSV import parser', () => {
  it('parses quoted commas, escaped quotes and CRLF safely', () => {
    const rows = parseStudentCsv(`\uFEFF${header}\r\n"A, Student",ab-1,g1a,"Parent ""One""",+966501234567,Guardian\r\n`);
    expect(rows).toEqual([{ studentDisplayName: 'A, Student', admissionNumber: 'AB-1', classCode: 'G1A', parentDisplayName: 'Parent "One"', parentPhoneE164: '+966501234567', relationship: 'Guardian' }]);
  });

  it('rejects duplicate admission numbers without case bypass', () => {
    expect(() => parseStudentCsv(`${header}\nOne,ab-1,G1A,Parent,+966501234567,Parent\nTwo,AB-1,G1A,Parent,+966501234568,Parent`)).toThrow();
  });

  it('allows one parent mobile number to be linked to multiple students', () => {
    const rows = parseStudentCsv(`${header}\nFirst,AB-1,G1A,Parent,+966501234567,Parent\nSecond,AB-2,G1A,Parent,+966501234567,Parent`);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.parentPhoneE164)).toEqual(['+966501234567', '+966501234567']);
  });

  it('rejects unclosed quotes and invalid mobile numbers', () => {
    expect(() => parseStudentCsv(`${header}\n"One,AB-1,G1A,Parent,+966501234567,Parent`)).toThrow();
    expect(() => parseStudentCsv(`${header}\nOne,AB-1,G1A,Parent,0501234567,Parent`)).toThrow();
  });
});
