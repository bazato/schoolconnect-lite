import { BadRequestException } from '@nestjs/common';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';

export function validateAttendanceSubmission(input: { attendanceDate: string; expectedVersion: number; idempotencyKey: string; correctionReason?: string; rows: Array<{ studentId: string; status: AttendanceStatus }> }) {
  const date = new Date(`${input.attendanceDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.attendanceDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.attendanceDate) throw new BadRequestException({ code: 'ATTENDANCE_DATE_INVALID' });
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey) throw new BadRequestException({ code: 'ATTENDANCE_VERSION_OR_IDEMPOTENCY_INVALID' });
  if (!input.rows?.length || new Set(input.rows.map((row) => row.studentId)).size !== input.rows.length) throw new BadRequestException({ code: 'INVALID_OR_DUPLICATE_ROWS' });
  const valid = new Set<AttendanceStatus>(['PRESENT', 'ABSENT', 'LATE', 'LEAVE']);
  if (input.rows.some((row) => !row.studentId || !valid.has(row.status))) throw new BadRequestException({ code: 'INVALID_ATTENDANCE_STATUS' });
  if (input.expectedVersion > 0 && (!input.correctionReason?.trim() || input.correctionReason.trim().length < 5)) throw new BadRequestException({ code: 'CORRECTION_REASON_REQUIRED' });
}
