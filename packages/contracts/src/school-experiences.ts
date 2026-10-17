export type TimetableSlot = { day: number; start: string; end: string; subject: string; room?: string };
export type PublishedTimetable = { id: string; classId: string; title: string; version: number; slots: TimetableSlot[]; publishedAt: string };
export type LeaveApplication = { id: string; classId: string; studentId: string; studentName?: string; startDate: string; endDate: string; reason: string; status: 'SUBMITTED' | 'ACKNOWLEDGED'; acknowledgementNote?: string; acknowledgedAt?: string; createdAt: string };
export type ResultChartPoint = { examName: string; subjectName: string; percentage: number; count: number; resultDate: string | null };
export function validSchoolDate(value: unknown): value is string {
  return typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validateLeaveApplication(input: { startDate?: unknown; endDate?: unknown; reason?: unknown }) {
  if (!validSchoolDate(input.startDate) || !validSchoolDate(input.endDate) || input.endDate < input.startDate ||
      typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.trim().length > 2000) throw new Error('LEAVE_APPLICATION_INVALID');
}
export function validateTimetable(input: { title?: unknown; slots?: unknown; expectedVersion?: unknown }): TimetableSlot[] {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160 ||
      !Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 0 ||
      !Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > 100) throw new Error('TIMETABLE_INVALID');
  const time = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const slots = input.slots.map((slot: TimetableSlot) => {
    if (!slot || !Number.isInteger(slot.day) || slot.day < 1 || slot.day > 7 || !time(slot.start) || !time(slot.end) || slot.end <= slot.start ||
        typeof slot.subject !== 'string' || !slot.subject.trim() || slot.subject.trim().length > 160 ||
        slot.room !== undefined && (typeof slot.room !== 'string' || slot.room.length > 100)) throw new Error('TIMETABLE_SLOT_INVALID');
    return { day: slot.day, start: slot.start, end: slot.end, subject: slot.subject.trim(), ...(slot.room?.trim() ? { room: slot.room.trim() } : {}) };
  }).sort((a,b) => a.day-b.day || a.start.localeCompare(b.start));
  for (let index=1; index<slots.length; index++) if (slots[index]!.day === slots[index-1]!.day && slots[index]!.start < slots[index-1]!.end) throw new Error('TIMETABLE_OVERLAP');
  return slots;
}
