// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassEditor, StudentEditor, TeacherEditor } from './AdminEditors';

const classes = [
  { id: 'class-a', displayName: 'Class A', classCode: 'A', gradeCode: 'G1', academicYear: '2026-2027', status: 'ACTIVE' },
  { id: 'class-b', displayName: 'Class B', classCode: 'B', gradeCode: 'G2', academicYear: '2026-2027', status: 'ACTIVE' },
];
let host: HTMLDivElement; let root: Root;
const api = vi.fn();
const request = async <T,>(path: string, init?: RequestInit): Promise<T> => await api(path, init) as T;
const saved = vi.fn();
const click = async (label: string) => { await act(async () => { const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label); expect(button, label).toBeDefined(); button!.click(); }); };
const submit = async (form: HTMLFormElement) => { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); api.mockReset(); saved.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('school administration editors', () => {
  it('saves editable class fields by stable ID without asking for a class code', async () => {
    api.mockResolvedValue({ ...classes[0], displayName: 'Renamed class' });
    await act(async () => root.render(<ClassEditor item={classes[0]!} request={request} onSaved={saved} />));
    await click('Edit');
    const input = host.querySelector<HTMLInputElement>('input[name="displayName"]')!; input.value = 'Renamed class';
    const academicYear = host.querySelector<HTMLInputElement>('input[name="academicYear"]')!; expect(academicYear.readOnly).toBe(false); academicYear.value='2027-2028';
    expect(host.querySelector('input[name="classCode"]')).toBeNull();
    await submit(host.querySelector('form')!);
    expect(api.mock.calls[0]?.[0]).toBe('/admin/classes/class-a');
    expect(JSON.parse(api.mock.calls[0]?.[1].body)).toEqual({ displayName: 'Renamed class', academicYear:'2027-2028',gradeCode: 'G1', status: 'ACTIVE' });
    expect(saved).toHaveBeenCalledOnce(); expect(host.querySelector('dialog')).toBeNull();
  });

  it('moves an existing student to another class without creating a new student or guardian', async () => {
    api.mockResolvedValue({ id: 'student', displayName: 'Student edited' });
    await act(async () => root.render(<StudentEditor item={{ id: 'student', displayName: 'Student', admissionNumber: 'SC-001', classId: 'class-a', status: 'ACTIVE' }} classes={classes} request={request} onSaved={saved} />));
    await click('Edit'); host.querySelector<HTMLInputElement>('input[name="displayName"]')!.value = 'Student edited'; host.querySelector<HTMLSelectElement>('select[name="classId"]')!.value = 'class-b';
    await submit(host.querySelector('form')!);
    expect(api).toHaveBeenCalledOnce(); expect(api.mock.calls[0]?.[0]).toBe('/admin/students/student'); expect(api.mock.calls[0]?.[1].method).toBe('PATCH');
    expect(JSON.parse(api.mock.calls[0]?.[1].body)).toMatchObject({ classId: 'class-b', displayName: 'Student edited' });
  });

  it('adds another class to the selected teacher account and refreshes its assignments', async () => {
    const assignment = { assignmentId: 'assignment-a', classId: 'class-a', className: 'Class A', subjectCode: 'MATH', subjectName: 'Mathematics', status: 'ACTIVE', canPublishResults: false, canPublishAnnouncements: true, canRecordAttendance: true };
    api.mockImplementation(async (_path: string, init?: RequestInit) => init?.method ? { assignmentId: 'assignment-b' } : [assignment]);
    await act(async () => root.render(<TeacherEditor item={{ membershipId: 'teacher', displayName: 'Teacher', phoneE164: '+966500000001', status: 'ACTIVE' }} classes={classes} request={request} onSaved={saved} />));
    await click('Edit / classes'); expect(host.textContent).toContain('Mathematics'); await click('＋ Assign another class');
    const form = host.querySelectorAll('form')[1]!; form.querySelector<HTMLSelectElement>('select[name="classId"]')!.value = 'class-b'; expect(form.querySelector('input[name="subjectCode"]')).toBeNull();form.querySelector<HTMLInputElement>('input[name="subjectName"]')!.value = 'Science';
    await submit(form);
    const posted = api.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(posted?.[0]).toBe('/admin/teachers/teacher/assignments'); expect(JSON.parse(posted?.[1].body)).toMatchObject({ classId: 'class-b', subjectName: 'Science', canRecordAttendance: true });
    expect(api.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2); expect(saved).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Class assignment saved');
  });

  it('keeps the editor open and shows a server validation error when saving fails', async () => {
    api.mockRejectedValue(new Error('CLASS_CODE_ALREADY_EXISTS'));
    await act(async () => root.render(<ClassEditor item={classes[0]!} request={request} onSaved={saved} />)); await click('Edit'); await submit(host.querySelector('form')!);
    expect(host.querySelector('dialog')?.open).toBe(true); expect(host.textContent).toContain('class code already exists'); expect(saved).not.toHaveBeenCalled();
  });
});
