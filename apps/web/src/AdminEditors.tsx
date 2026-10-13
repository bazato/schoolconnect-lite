import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Class = { id: string; displayName: string; classCode: string; gradeCode?: string; academicYear: string; status: string };
type Teacher = { membershipId: string; displayName: string; phoneE164: string; status: string };
type Student = { id: string; displayName: string; admissionNumber: string; classId: string; status: string };
type Assignment = { assignmentId: string; classId: string; className: string; subjectCode: string; subjectName: string; status: string; canPublishResults: boolean; canPublishAnnouncements: boolean; canRecordAttendance: boolean };
const message = (error: unknown) => error instanceof Error ? error.message.replaceAll('_', ' ').toLowerCase() : 'Unable to save. Please try again.';

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="editor-dialog" onCancel={close} aria-label={title}>
    <div className="card-heading"><h3>{title}</h3><button type="button" className="icon-button" onClick={close} aria-label="Close editor">×</button></div>{children}
  </dialog>;
}

export function ClassEditor({ item, request, onSaved }: { item: Class; request: Request; onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await request(`/admin/classes/${item.id}`, { method: 'PATCH', body: JSON.stringify({ displayName: data.get('displayName'), classCode: data.get('classCode'), gradeCode: data.get('gradeCode'), status: data.get('status') }) }); onSaved(); setOpen(false); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  };
  return <><button className="text-button" onClick={() => { setError(''); setOpen(true); }} aria-label={`Edit class ${item.displayName}`}>Edit</button>{open && <Dialog title="Edit class" close={() => setOpen(false)}><form className="data-form" onSubmit={(event) => { void save(event); }}>
    <label>Class name<input name="displayName" defaultValue={item.displayName} required maxLength={120} /></label><label>Class code<input name="classCode" defaultValue={item.classCode} required pattern="[A-Za-z0-9_-]+" maxLength={40} /></label>
    <label>Grade code<input name="gradeCode" defaultValue={item.gradeCode ?? ''} maxLength={40} pattern="[A-Za-z0-9_-]*" /></label><label>Academic year<input value={item.academicYear} readOnly /></label>
    <label>Status<select name="status" defaultValue={item.status}><option>ACTIVE</option><option>ARCHIVED</option></select></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save class'}</button></div>
  </form>{error && <div className="alert danger">{error}</div>}</Dialog>}</>;
}

export function StudentEditor({ item, classes, request, onSaved }: { item: Student; classes: Class[]; request: Request; onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await request(`/admin/students/${item.id}`, { method: 'PATCH', body: JSON.stringify({ displayName: data.get('displayName'), classId: data.get('classId') || undefined, status: data.get('status') }) }); onSaved(); setOpen(false); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  };
  return <><button className="text-button" onClick={() => { setError(''); setOpen(true); }} aria-label={`Edit student ${item.displayName}`}>Edit</button>{open && <Dialog title="Edit student" close={() => setOpen(false)}><form className="data-form" onSubmit={(event) => { void save(event); }}>
    <label>Student name<input name="displayName" defaultValue={item.displayName} required maxLength={160} /></label><label>Admission number<input value={item.admissionNumber} readOnly /></label>
    <label>Class<select name="classId" defaultValue={item.classId ?? ''} required><option value="" disabled>Select a class</option>{classes.filter((c) => c.status === 'ACTIVE' || c.id === item.classId).map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
    <label>Status<select name="status" defaultValue={item.status}><option>ACTIVE</option><option>INACTIVE</option><option>GRADUATED</option></select></label>
    <div className="form-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save student'}</button></div>
  </form>{error && <div className="alert danger">{error}</div>}</Dialog>}</>;
}

export function TeacherEditor({ item, classes, request, onSaved }: { item: Teacher; classes: Class[]; request: Request; onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [assignments, setAssignments] = useState<Assignment[]>([]); const [editing, setEditing] = useState<Assignment | null>(null); const [adding, setAdding] = useState(false);
  const load = async () => { setAssignments(await request<Assignment[]>(`/admin/teachers/${item.membershipId}/assignments`)); };
  const show = async () => { setError(''); setNotice(''); setEditing(null); setAdding(false); setAssignments([]); setOpen(true); setBusy(true); try { await load(); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await request(`/admin/members/${item.membershipId}`, { method: 'PATCH', body: JSON.stringify({ displayName: data.get('displayName'), phoneE164: String(data.get('phoneE164')).replace(/\s/g, ''), status: data.get('status') }) }); await load(); onSaved(); setNotice('Teacher profile saved.'); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  };
  const saveAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('');
    const body = { classId: data.get('classId'), subjectCode: data.get('subjectCode'), subjectName: data.get('subjectName'), status: data.get('status') ?? 'ACTIVE', canPublishResults: data.get('canPublishResults') === 'on', canPublishAnnouncements: data.get('canPublishAnnouncements') === 'on', canRecordAttendance: data.get('canRecordAttendance') === 'on' };
    try { await request(editing ? `/admin/assignments/${editing.assignmentId}` : `/admin/teachers/${item.membershipId}/assignments`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) }); await load(); onSaved(); setEditing(null); setAdding(false); setNotice('Class assignment saved. The teacher can select it in the mobile app.'); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  };
  return <><button className="text-button" onClick={() => { void show(); }} aria-label={`Edit teacher ${item.displayName}`}>Edit / classes</button>{open && <Dialog title="Manage teacher" close={() => setOpen(false)}>
    <form className="data-form" onSubmit={(event) => { void saveProfile(event); }}><label>Teacher name<input name="displayName" defaultValue={item.displayName} required maxLength={160} /></label><label>Mobile number<input name="phoneE164" defaultValue={item.phoneE164} required inputMode="tel" pattern="\+[1-9][0-9]{7,14}" /></label><label>Status<select name="status" defaultValue={item.status}><option>ACTIVE</option><option>REVOKED</option></select></label><div className="form-actions"><button className="button primary" disabled={busy}>Save teacher</button></div></form>
    <div className="card-heading editor-section"><div><h3>Class assignments</h3><p className="muted">Add a class to this teacher account. Each assignment has its own permissions.</p></div><button className="button secondary small" disabled={busy || item.status !== 'ACTIVE'} onClick={() => { setAdding(true); setEditing(null); }}>＋ Assign another class</button></div>
    <div className="table-wrap"><table><thead><tr><th>Class</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead><tbody>{assignments.map((a) => <tr key={a.assignmentId}><td>{a.className}</td><td>{a.subjectName}</td><td>{a.status}</td><td><button className="text-button" disabled={busy} onClick={() => { setEditing(a); setAdding(false); }}>Edit assignment</button></td></tr>)}</tbody></table></div>
    {(adding || editing) && <form className="data-form editor-section" key={editing?.assignmentId ?? 'new'} onSubmit={(event) => { void saveAssignment(event); }}>
      <label>Class<select name="classId" required defaultValue={editing?.classId ?? ''}><option value="" disabled>Select a class</option>{classes.filter((c) => c.status === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
      <label>Subject name<input name="subjectName" required maxLength={120} defaultValue={editing?.subjectName ?? ''} readOnly={Boolean(editing)} /></label><label>Subject code<input name="subjectCode" required maxLength={60} defaultValue={editing?.subjectCode ?? ''} readOnly={Boolean(editing)} /></label>
      {editing && <label>Status<select name="status" defaultValue={editing.status}><option>ACTIVE</option><option>REVOKED</option></select></label>}
      <div className="permission-list"><label className="check-toggle"><input type="checkbox" name="canPublishResults" defaultChecked={editing?.canPublishResults ?? false} /> Publish results</label><label className="check-toggle"><input type="checkbox" name="canPublishAnnouncements" defaultChecked={editing?.canPublishAnnouncements ?? true} /> Publish announcements</label><label className="check-toggle"><input type="checkbox" name="canRecordAttendance" defaultChecked={editing?.canRecordAttendance ?? true} /> Record attendance</label></div>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => { setEditing(null); setAdding(false); }}>Cancel assignment</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save assignment'}</button></div>
    </form>}{notice && <div className="alert success">{notice}</div>}{error && <div className="alert danger">{error}</div>}
  </Dialog>}</>;
}
