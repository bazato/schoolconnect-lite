import { describe, expect, it } from 'vitest';
import { validateAttendanceSubmission } from './validation';

const valid = () => ({ attendanceDate: '2026-09-27', expectedVersion: 0, idempotencyKey: 'key-1', rows: [{ studentId: 'student-1', status: 'PRESENT' as const }] });

describe('attendance submission validation', () => {
  it('accepts an initial complete batch and a reasoned correction', () => {
    expect(() => validateAttendanceSubmission(valid())).not.toThrow();
    expect(() => validateAttendanceSubmission({ ...valid(), expectedVersion: 1, correctionReason: 'School-approved correction' })).not.toThrow();
  });

  it('rejects duplicate students and unsupported statuses', () => {
    expect(() => validateAttendanceSubmission({ ...valid(), rows: [valid().rows[0]!, valid().rows[0]!] })).toThrow();
    expect(() => validateAttendanceSubmission({ ...valid(), rows: [{ studentId: 'student-1', status: 'UNKNOWN' as 'PRESENT' }] })).toThrow();
  });

  it('requires a correction reason and a real calendar date', () => {
    expect(() => validateAttendanceSubmission({ ...valid(), expectedVersion: 1 })).toThrow();
    expect(() => validateAttendanceSubmission({ ...valid(), attendanceDate: '2026-02-30' })).toThrow();
  });
});
