import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiBaseUrl, apiRequest, readSession, requestOtp, saveSession, verifyOtp, type AppContext, type Membership, type Role, type Session } from './api';
import { downloadResultsTemplate, parseResultsWorkbook, type ResultRow } from './results-workbook';

type SchoolRow = { id: string; schoolCode: string; displayName: string; timezone: string; status: string; activeStudentCount?: number; totalStudentCount?: number; activeTeacherCount?: number; activeParentCount?: number; activeAdminCount?: number };
type MemberRow = { userId: string; membershipId: string; displayName: string; phoneE164: string; role: Role; status: string };
type ClassRow = { id: string; classCode: string; displayName: string; academicYear: string; gradeCode?: string; status: string };
type StudentRow = { id: string; admissionNumber: string; displayName: string; classId: string; className: string; guardianCount: number; status: string };
type Invitation = { code: string; phone: string; role: string; expiresAt?: string };
type PreviewRow = ResultRow & { row: number; studentId: string | null; studentName: string | null; classId: string | null; className: string | null; guardianCount: number; status: 'READY' | 'INVALID'; error?: string };
type Summary = { studentCount: number; teacherCount: number; attendance?: Array<{ classId: string; status: string; count: number }>; recentAudit?: Array<{ action: string; createdAt: string }> };
type Page = 'Overview' | 'Schools' | 'Classes' | 'Teachers' | 'Students' | 'Results';

const roleLabel: Record<Role, string> = { PLATFORM_OWNER: 'Platform owner', SCHOOL_ADMIN: 'School administrator', TEACHER: 'Teacher', PARENT: 'Parent' };
const displayError = (error: unknown) => error instanceof Error ? error.message.replaceAll('_', ' ').toLowerCase() : 'Something went wrong. Please try again.';
const localDate = () => new Date().toLocaleDateString('en-CA');

export function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [context, setContext] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(Boolean(readSession()));
  const [error, setError] = useState('');

  const updateSession = useCallback((value: Session | null) => { setSession(value); saveSession(value); }, []);
  const request = useCallback(<T,>(path: string, init: RequestInit = {}) => apiRequest<T>(path, session, (value) => updateSession(value), init), [session, updateSession]);

  useEffect(() => {
    if (!session) { setContext(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    void request<AppContext>('/me/context').then((value) => { if (active) { setContext(value); setError(''); } })
      .catch((failure: unknown) => { if (!active) return; setError(displayError(failure)); if (failure instanceof Error && failure.message.includes('SESSION_EXPIRED')) updateSession(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.accessToken, request, updateSession]);

  if (!session) return <SignIn onSignedIn={updateSession} />;
  if (loading || !context) return <div className="boot-screen"><div className="brand-mark">✦</div><div className="spinner" /><p>{error || 'Opening your secure school workspace…'}</p><button className="button quiet" onClick={() => { updateSession(null); setError(''); }}>Sign in again</button></div>;
  return <Portal context={context} session={session} onSession={updateSession} request={request} onSignOut={() => { void request('/auth/logout', { method: 'POST' }).catch(() => undefined); updateSession(null); }} />;
}

function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [phone, setPhone] = useState('');
  const [invitation, setInvitation] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await requestOtp(phone, invitation);
      setChallengeId(result.challengeId); setDevelopmentCode(result.developmentCode ?? '');
      if (result.developmentCode) setOtp(result.developmentCode);
    } catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  const submitOtp = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { onSignedIn(await verifyOtp(challengeId, otp.trim())); }
    catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };

  return <main className="login-layout">
    <section className="login-brand-panel">
      <div className="brand-lockup"><span className="brand-mark">✦</span><span>SchoolConnect<span className="brand-lite"> Lite</span></span></div>
      <div className="login-message"><span className="eyebrow">SCHOOL OPERATIONS, IN ONE PLACE</span><h1>Make every school day run a little smoother.</h1><p>Manage your schools, people and academic results through one clear, role-aware workspace.</p></div>
      <div className="login-panel-footer"><span className="security-dot" /> Private access for invited school teams</div>
    </section>
    <section className="login-form-panel">
      <div className="login-form-wrap">
        <div className="mobile-brand brand-lockup"><span className="brand-mark">✦</span><span>SchoolConnect<span className="brand-lite"> Lite</span></span></div>
        <span className="eyebrow">WELCOME BACK</span>
        <h2>{challengeId ? 'Verify your number' : 'Sign in to your workspace'}</h2>
        <p className="muted">{challengeId ? `Enter the one-time code sent to ${phone}.` : 'Use the mobile number registered by your platform owner or school administrator.'}</p>
        {!challengeId ? <form onSubmit={(event) => { void sendCode(event); }} className="stack-form">
          <label>Mobile number<input autoComplete="tel" inputMode="tel" placeholder="+966 5X XXX XXXX" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
          <label>Invitation code <span className="optional">(first sign-in only)</span><input autoComplete="one-time-code" placeholder="Provided by your school" value={invitation} onChange={(event) => setInvitation(event.target.value.trim())} /></label>
          <button className="button primary full" disabled={busy}>{busy ? 'Sending code…' : 'Send sign-in code'} <span>→</span></button>
        </form> : <form onSubmit={(event) => { void submitOtp(event); }} className="stack-form">
          {developmentCode && <div className="demo-code"><span>Demo sign-in code</span><strong>{developmentCode}</strong><span>Displayed because this environment uses mocked OTP.</span></div>}
          <label>One-time code<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={otp} onChange={(event) => setOtp(event.target.value)} required /></label>
          <button className="button primary full" disabled={busy}>{busy ? 'Verifying…' : 'Continue'} <span>→</span></button>
          <button type="button" className="text-button" onClick={() => { setChallengeId(''); setOtp(''); setDevelopmentCode(''); }}>Use a different number</button>
        </form>}
        {error && <div className="alert danger">{error}</div>}
        <div className="login-note"><span>⌑</span><p>School and role permissions are checked by the SchoolConnect services each time you use the portal.</p></div>
        <div className="api-footnote">Connected to <code>{apiBaseUrl}</code></div>
      </div>
    </section>
  </main>;
}

function Portal({ context, session, onSession, request, onSignOut }: {
  context: AppContext; session: Session; onSession: (session: Session) => void;
  request: <T>(path: string, init?: RequestInit) => Promise<T>; onSignOut: () => void;
}) {
  const owner = context.principal.role === 'PLATFORM_OWNER';
  const admin = context.principal.role === 'SCHOOL_ADMIN';
  const allowedPages: Page[] = owner ? ['Overview', 'Schools'] : admin ? ['Overview', 'Classes', 'Teachers', 'Students', 'Results'] : ['Overview'];
  const [page, setPage] = useState<Page>('Overview');
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<MemberRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true); setError('');
    try {
      if (context.principal.role === 'PLATFORM_OWNER') {
        const [schoolRows, platform] = await Promise.all([
          request<SchoolRow[]>('/admin/schools'), request<{ schoolCount: number; activeSchoolCount: number; schools: SchoolRow[] }>('/admin/reports/platform-summary'),
        ]);
        setSchools(platform.schools ?? schoolRows);
      } else if (context.principal.role === 'SCHOOL_ADMIN') {
        const [classRows, teacherRows, studentRows, report] = await Promise.all([
          request<ClassRow[]>('/admin/classes'), request<MemberRow[]>('/admin/teachers'), request<StudentRow[]>('/admin/students'),
          request<Summary>(`/admin/reports/summary?fromDate=${localDate()}&toDate=${localDate()}`),
        ]);
        setClasses(classRows); setTeachers(teacherRows); setStudents(studentRows); setSummary(report);
      }
    } catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  }, [context.principal.role, request]);

  useEffect(() => { void reload(); }, [reload]);

  const switchRole = async (event: FormEvent<HTMLSelectElement>) => {
    const membershipId = event.currentTarget.value;
    if (!membershipId || membershipId === context.principal.membershipId) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ accessToken: string; activeMembership: Membership }>('/auth/switch-role', { method: 'POST', body: JSON.stringify({ membershipId }) });
      onSession({ ...session, accessToken: result.accessToken, activeMembershipId: result.activeMembership.id });
    } catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  const announce = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 5000); };
  const invite = (value: Invitation) => { setInvitation(value); setFormOpen(false); };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup sidebar-brand"><span className="brand-mark">✦</span><span>SchoolConnect<span className="brand-lite"> Lite</span></span></div>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-card"><div className="workspace-avatar">{context.principal.displayName.slice(0, 1).toUpperCase()}</div><div className="workspace-copy"><strong>{context.school?.displayName ?? 'Platform workspace'}</strong><small>{roleLabel[context.principal.role]}</small></div><span className="workspace-chevron">⌄</span></div>
      <nav className="side-nav" aria-label="Main navigation">
        <div className="nav-section-label">MANAGE</div>
        {allowedPages.map((item) => <button key={item} className={`nav-item ${page === item ? 'selected' : ''}`} onClick={() => { setPage(item); setError(''); }}>
          <span className="nav-icon">{item === 'Overview' ? '◫' : item === 'Schools' ? '⌂' : item === 'Classes' ? '▦' : item === 'Teachers' ? '♙' : item === 'Students' ? '◎' : '▤'}</span>{item}
          {item === 'Results' && <span className="nav-pill">NEW</span>}
        </button>)}
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">?</div><div><strong>Need a hand?</strong><small>Ask your platform owner</small></div></div><div className="profile-row"><div className="profile-avatar">{context.principal.displayName.slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{context.principal.displayName}</strong><small>{context.principal.role.toLowerCase().replaceAll('_', ' ')}</small></div><button className="signout" title="Sign out" onClick={onSignOut}>↗</button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>SchoolConnect</span><b>/</b><strong>{page}</strong></div><div className="topbar-actions">
        {session.memberships.length > 1 && <label className="role-switch"><span>View as</span><select aria-label="Switch role" value={context.principal.membershipId} onChange={(event) => { void switchRole(event); }}>
          {session.memberships.map((membership) => <option key={membership.id} value={membership.id}>{roleLabel[membership.role]}{membership.schoolId && membership.schoolId !== context.principal.schoolId ? ' · another school' : ''}</option>)}
        </select></label>}
        <span className="topbar-divider" /><div className="online-state"><i /> Connected</div><button className="round-button" title="Refresh data" onClick={() => { void reload(); }}>↻</button>
      </div></header>
      <section className="page-wrap">
        <div className="page-heading"><div><div className="eyebrow">{context.principal.role === 'PLATFORM_OWNER' ? 'PLATFORM MANAGEMENT' : context.school?.schoolCode ?? 'SCHOOL ADMINISTRATION'}</div><h1>{headingFor(page)}</h1><p>{descriptionFor(page, context)}</p></div>
          {page === 'Schools' && <button className="button primary" onClick={() => setFormOpen(!formOpen)}><span>＋</span> Add school</button>}
          {page === 'Classes' && <button className="button primary" onClick={() => setFormOpen(!formOpen)}><span>＋</span> Create class</button>}
          {page === 'Teachers' && <button className="button primary" onClick={() => setFormOpen(!formOpen)}><span>＋</span> Add teacher</button>}
        </div>
        {error && <div className="alert danger">{error}<button onClick={() => setError('')}>×</button></div>}
        {notice && <div className="alert success">{notice}</div>}
        {invitation && <div className="invitation-banner"><div className="invite-icon">✓</div><div className="invite-copy"><strong>{invitation.role} account is ready</strong><span>Send this one-time invitation to {invitation.phone}. The user will set up access on first sign-in.</span></div><code>{invitation.code}</code><button className="button secondary small" onClick={() => { void navigator.clipboard?.writeText(invitation.code); announce('Invitation copied. Share it securely with the invited user.'); }}>Copy code</button><button className="icon-button" onClick={() => setInvitation(null)} aria-label="Dismiss invitation">×</button></div>}
        {page === 'Overview' && <Overview owner={owner} context={context} schools={schools} classes={classes} teachers={teachers} students={students} summary={summary} busy={busy} onNavigate={setPage} />}
        {page === 'Schools' && <OwnerSchools schools={schools} request={request} selectedSchool={selectedSchool} setSelectedSchool={setSelectedSchool} members={members} setMembers={setMembers} formOpen={formOpen} setFormOpen={setFormOpen} onInvite={invite} onMessage={announce} />}
        {page === 'Classes' && <ClassesPage classes={classes} formOpen={formOpen} setFormOpen={setFormOpen} request={request} onSaved={() => { void reload(); announce('Class created successfully.'); }} />}
        {page === 'Teachers' && <TeachersPage teachers={teachers} classes={classes} formOpen={formOpen} setFormOpen={setFormOpen} request={request} onInvite={invite} onSaved={() => { void reload(); announce('Teacher account and class assignment created.'); }} />}
        {page === 'Students' && <StudentsPage students={students} />}
        {page === 'Results' && <ResultsPage students={students} request={request} onMessage={announce} />}
        <footer className="page-footer"><span>SchoolConnect Lite</span><span>Role-scoped workspace · {context.school?.displayName ?? 'All schools'}</span></footer>
      </section>
    </main>
  </div>;
}

function headingFor(page: Page) { return page === 'Overview' ? 'Good to see you' : page === 'Schools' ? 'Schools' : page === 'Classes' ? 'Classes & grades' : page === 'Teachers' ? 'Teachers' : page === 'Students' ? 'Students' : 'Publish results'; }
function descriptionFor(page: Page, context: AppContext) {
  if (page === 'Overview') return context.principal.role === 'PLATFORM_OWNER' ? 'Here is what is happening across your school network.' : 'A clear view of your school, team and academic activity.';
  if (page === 'Schools') return 'Create schools and provision their first school administrator.';
  if (page === 'Classes') return 'Set up the academic year and keep class rosters organized.';
  if (page === 'Teachers') return 'Invite teachers and assign the classes and capabilities they need.';
  if (page === 'Students') return 'Review the current student roster and guardian links.';
  return 'Import a spreadsheet, review every row, then publish private results to each student’s linked guardians.';
}

function Overview({ owner, context, schools, classes, teachers, students, summary, busy, onNavigate }: {
  owner: boolean; context: AppContext; schools: SchoolRow[]; classes: ClassRow[]; teachers: MemberRow[]; students: StudentRow[]; summary: Summary | null; busy: boolean; onNavigate: (page: Page) => void;
}) {
  const metrics = owner ? [
    { label: 'Schools', value: schools.length, icon: '⌂', note: 'In your network' },
    { label: 'Active schools', value: schools.filter((item) => item.status === 'ACTIVE').length, icon: '✓', note: 'Ready to use' },
    { label: 'Teachers', value: schools.reduce((sum, item) => sum + (item.activeTeacherCount ?? 0), 0), icon: '♙', note: 'Across all schools' },
    { label: 'Students', value: schools.reduce((sum, item) => sum + (item.activeStudentCount ?? 0), 0), icon: '◎', note: 'Across all schools' },
  ] : [
    { label: 'Students', value: summary?.studentCount ?? students.length, icon: '◎', note: 'In this school' },
    { label: 'Teachers', value: summary?.teacherCount ?? teachers.length, icon: '♙', note: 'Active members' },
    { label: 'Classes', value: classes.length, icon: '▦', note: 'Academic groups' },
    { label: 'Attendance updates', value: summary?.attendance?.reduce((sum, item) => sum + item.count, 0) ?? 0, icon: '◷', note: 'Today' },
  ];
  return <div className="overview-grid">
    <div className="welcome-card"><div><span className="eyebrow">{context.school?.displayName ?? 'YOUR PLATFORM'}</span><h2>{owner ? 'Your school network, at a glance.' : 'Everything your school needs to get started.'}</h2><p>{owner ? 'Add a school, appoint its administrator, and keep access organized from here.' : 'Start by setting up classes and adding your teachers and students.'}</p></div><span className="welcome-art"><span>✦</span><i /><b /></span></div>
    <div className="metric-grid">{metrics.map((metric, index) => <article className={`metric-card metric-${index}`} key={metric.label}><span className="metric-icon">{metric.icon}</span><span className="metric-label">{metric.label}</span><strong>{busy ? '—' : metric.value.toLocaleString()}</strong><small>{metric.note}</small></article>)}</div>
    <div className="section-card quick-card"><div className="card-heading"><div><span className="eyebrow">QUICK ACTIONS</span><h3>What would you like to do?</h3></div></div><div className="quick-actions">
      {(owner ? [['Schools', '＋', 'Add a school'], ['Schools', '⌑', 'Manage administrators']] : [['Classes', '▦', 'Create a class'], ['Teachers', '♙', 'Add a teacher'], ['Results', '▤', 'Import results']]).map(([page, icon, label]) => <button key={label} className="quick-action" onClick={() => onNavigate(page as Page)}><span>{icon}</span><strong>{label}</strong><i>→</i></button>)}
    </div></div>
    <div className="section-card recent-card"><div className="card-heading"><div><span className="eyebrow">{owner ? 'SCHOOL NETWORK' : 'YOUR SCHOOL'}</span><h3>{owner ? 'Recently added schools' : 'Set up checklist'}</h3></div><button className="text-button" onClick={() => onNavigate(owner ? 'Schools' : 'Classes')}>{owner ? 'View all schools' : 'Open setup'} →</button></div>
      {owner ? schools.length ? <div className="table-wrap"><table><thead><tr><th>School</th><th>Code</th><th>Administrators</th><th>Status</th></tr></thead><tbody>{schools.slice(0, 5).map((school) => <tr key={school.id}><td><div className="table-person"><span className="school-token">{school.displayName.slice(0, 1)}</span><strong>{school.displayName}</strong></div></td><td><code>{school.schoolCode}</code></td><td>{school.activeAdminCount ?? '—'}</td><td><StatusPill value={school.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No schools yet" body="Add the first school to get your platform started." action="Add a school" onClick={() => onNavigate('Schools')} /> : <div className="checklist">
        {[[classes.length > 0, 'Create your school’s classes', 'Set the academic year and grade groups.'], [teachers.length > 0, 'Invite your teachers', 'Assign teachers to classes and subjects.'], [students.length > 0, 'Add your students', 'Use student administration or CSV import.'], [false, 'Publish your first result', 'Upload a results workbook for guardian delivery.']].map(([done, title, body], index) => <button key={String(title)} className="check-item" onClick={() => onNavigate((['Classes', 'Teachers', 'Students', 'Results'] as Page[])[index]!)}><span className={`check-circle ${done ? 'done' : ''}`}>{done ? '✓' : index + 1}</span><span><strong>{String(title)}</strong><small>{String(body)}</small></span><i>→</i></button>)}
      </div>}
    </div>
  </div>;
}

function OwnerSchools({ schools, request, selectedSchool, setSelectedSchool, members, setMembers, formOpen, setFormOpen, onInvite, onMessage }: {
  schools: SchoolRow[]; request: <T>(path: string, init?: RequestInit) => Promise<T>; selectedSchool: string; setSelectedSchool: (id: string) => void;
  members: MemberRow[]; setMembers: (value: MemberRow[]) => void; formOpen: boolean; setFormOpen: (value: boolean) => void;
  onInvite: (value: Invitation) => void; onMessage: (message: string) => void;
}) {
  const [adminsBusy, setAdminsBusy] = useState(false);
  const [adminsError, setAdminsError] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [search, setSearch] = useState('');
  const selected = schools.find((school) => school.id === selectedSchool);
  const filteredSchools = schools.filter((school) => `${school.displayName} ${school.schoolCode}`.toLowerCase().includes(search.toLowerCase()));

  const createSchool = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSchoolBusy(true); setAdminsError('');
    try {
      const created = await request<{ school: SchoolRow; administrator: { invitationCode: string; expiresAt: string } }>('/admin/schools', { method: 'POST', body: JSON.stringify({
        schoolCode: String(form.get('schoolCode')).trim().toUpperCase(), displayName: String(form.get('displayName')).trim(), timezone: String(form.get('timezone')),
        adminDisplayName: String(form.get('adminDisplayName')).trim(), adminPhoneE164: String(form.get('adminPhoneE164')).replace(/\s/g, ''),
      }) });
      onInvite({ code: created.administrator.invitationCode, phone: String(form.get('adminPhoneE164')), role: 'School administrator', expiresAt: created.administrator.expiresAt });
      setSelectedSchool(created.school.id); setFormOpen(false); onMessage('School and first administrator were created.');
    } catch (failure) { setAdminsError(displayError(failure)); }
    finally { setSchoolBusy(false); }
  };
  const loadAdmins = async (schoolId: string) => {
    setSelectedSchool(schoolId); setAdminsBusy(true); setAdminsError('');
    try { setMembers(await request<MemberRow[]>(`/admin/schools/${schoolId}/admins`)); }
    catch (failure) { setAdminsError(displayError(failure)); }
    finally { setAdminsBusy(false); }
  };
  const addAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedSchool) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement); setAddingAdmin(true); setAdminsError('');
    try {
      const result = await request<{ invitationCode: string; expiresAt: string }>('/admin/schools/' + selectedSchool + '/admins', { method: 'POST', body: JSON.stringify({ displayName: String(form.get('displayName')).trim(), phoneE164: String(form.get('phoneE164')).replace(/\s/g, '') }) });
      onInvite({ code: result.invitationCode, phone: String(form.get('phoneE164')), role: 'School administrator', expiresAt: result.expiresAt });
      await loadAdmins(selectedSchool); formElement.reset();
    } catch (failure) { setAdminsError(displayError(failure)); }
    finally { setAddingAdmin(false); }
  };

  return <div className="content-stack">
    {formOpen && <section className="section-card form-card"><div className="card-heading"><div><span className="eyebrow">NEW SCHOOL</span><h3>School details & first administrator</h3></div><button className="icon-button" onClick={() => setFormOpen(false)}>×</button></div>
      <form className="data-form" onSubmit={(event) => { void createSchool(event); }}><label>School name<input name="displayName" placeholder="e.g. Al Noor International School" required maxLength={160} /></label><label>School code<input name="schoolCode" placeholder="e.g. ALNOOR01" required maxLength={40} /></label><label>Timezone<select name="timezone" defaultValue="Asia/Riyadh"><option value="Asia/Riyadh">Asia/Riyadh</option><option value="Asia/Kolkata">Asia/Kolkata</option><option value="Asia/Dubai">Asia/Dubai</option><option value="UTC">UTC</option></select></label><div className="form-divider">FIRST SCHOOL ADMINISTRATOR</div><label>Administrator name<input name="adminDisplayName" placeholder="Full name" required /></label><label>Administrator mobile<input name="adminPhoneE164" placeholder="+966 5X XXX XXXX" required inputMode="tel" /></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="button primary" disabled={schoolBusy}>{schoolBusy ? 'Creating…' : 'Create school & invite admin'}</button></div></form>
      {adminsError && <div className="alert danger">{adminsError}</div>}
    </section>}
    <section className="section-card"><div className="card-heading"><div><span className="eyebrow">NETWORK DIRECTORY</span><h3>{schools.length} {schools.length === 1 ? 'school' : 'schools'} in your network</h3></div><span className="directory-search">⌕ <input placeholder="Search schools" aria-label="Search schools" value={search} onChange={(event) => setSearch(event.target.value)} /></span></div>
      {schools.length ? filteredSchools.length ? <div className="school-grid">{filteredSchools.map((school) => <article className="school-card" key={school.id}><div className="school-card-top"><span className="school-token large">{school.displayName.slice(0, 1)}</span><StatusPill value={school.status} /></div><h3>{school.displayName}</h3><div className="school-code">{school.schoolCode}{school.timezone && <> <span>·</span> {school.timezone}</>}</div><div className="school-stats"><span><strong>{school.activeTeacherCount ?? 0}</strong> teachers</span><span><strong>{school.activeStudentCount ?? 0}</strong> students</span><span><strong>{school.activeAdminCount ?? 0}</strong> admins</span></div><button className={`button ${selectedSchool === school.id ? 'secondary' : 'light'} full`} onClick={() => { void loadAdmins(school.id); }}>{selectedSchool === school.id ? 'Administrators selected' : 'Manage administrators'} <span>→</span></button></article>)}</div> : <div className="empty-inline">No schools match “{search}”.</div> : <EmptyState title="Your school network starts here" body="Create a school and its first school administrator to begin onboarding." action="Add your first school" onClick={() => setFormOpen(true)} />}
    </section>
    {selected && <section className="section-card"><div className="card-heading"><div><span className="eyebrow">{selected.schoolCode}</span><h3>Administrators · {selected.displayName}</h3></div><span className="subtle-count">{members.length} accounts</span></div>
      {adminsError && <div className="alert danger">{adminsError}</div>}{adminsBusy ? <div className="skeleton-line" /> : <div className="table-wrap"><table><thead><tr><th>Administrator</th><th>Mobile</th><th>Access</th><th>Status</th><th /></tr></thead><tbody>{members.map((member) => <tr key={member.membershipId}><td><div className="table-person"><span className="person-avatar">{member.displayName.slice(0, 1)}</span><strong>{member.displayName}</strong></div></td><td>{member.phoneE164}</td><td>School administrator</td><td><StatusPill value={member.status} /></td><td><button className="text-button" onClick={async () => { try { const result = await request<{ invitationCode: string; expiresAt: string }>(`/admin/schools/${selected.id}/admins/${member.membershipId}/reissue-invitation`, { method: 'POST' }); onInvite({ code: result.invitationCode, phone: member.phoneE164, role: 'School administrator', expiresAt: result.expiresAt }); } catch (failure) { setAdminsError(displayError(failure)); } }}>Reissue invite</button></td></tr>)}</tbody></table></div>}
      <form className="inline-invite-form" onSubmit={(event) => { void addAdmin(event); }}><span className="invite-icon">＋</span><div><strong>Add another school administrator</strong><small>They will only manage {selected.displayName}.</small></div><input name="displayName" aria-label="Administrator name" placeholder="Full name" required /><input name="phoneE164" aria-label="Administrator mobile" placeholder="+966 mobile" required inputMode="tel" /><button className="button primary small" disabled={addingAdmin}>{addingAdmin ? 'Adding…' : 'Add admin'}</button></form>
    </section>}
  </div>;
}

function ClassesPage({ classes, formOpen, setFormOpen, request, onSaved }: {
  classes: ClassRow[]; formOpen: boolean; setFormOpen: (value: boolean) => void; request: <T>(path: string, init?: RequestInit) => Promise<T>; onSaved: () => void;
}) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await request('/admin/classes', { method: 'POST', body: JSON.stringify({ classCode: String(form.get('classCode')).trim().toUpperCase(), displayName: String(form.get('displayName')).trim(), gradeCode: String(form.get('gradeCode')).trim().toUpperCase(), academicYear: String(form.get('academicYear')).trim() }) }); onSaved(); setFormOpen(false); }
    catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  return <div className="content-stack">
    {formOpen && <section className="section-card form-card"><div className="card-heading"><div><span className="eyebrow">CLASS SETUP</span><h3>Create a class</h3></div><button className="icon-button" onClick={() => setFormOpen(false)}>×</button></div><form className="data-form compact" onSubmit={(event) => { void create(event); }}><label>Class name<input name="displayName" placeholder="Grade 5 — Section A" required /></label><label>Class code<input name="classCode" placeholder="G5A" required /></label><label>Grade code<input name="gradeCode" placeholder="G5" required /></label><label>Academic year<input name="academicYear" placeholder="2026-2027" pattern="\d{4}-\d{4}" required /></label><div className="form-actions"><button className="button secondary" type="button" onClick={() => setFormOpen(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Create class'}</button></div></form>{error && <div className="alert danger">{error}</div>}</section>}
    <section className="section-card"><div className="card-heading"><div><span className="eyebrow">ACADEMIC STRUCTURE</span><h3>Current classes</h3></div><span className="subtle-count">{classes.length} total</span></div>{classes.length ? <div className="table-wrap"><table><thead><tr><th>Class</th><th>Code</th><th>Grade</th><th>Academic year</th><th>Status</th></tr></thead><tbody>{classes.map((item) => <tr key={item.id}><td><div className="table-person"><span className="class-token">▦</span><strong>{item.displayName}</strong></div></td><td><code>{item.classCode}</code></td><td>{item.gradeCode ?? '—'}</td><td>{item.academicYear}</td><td><StatusPill value={item.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No classes set up yet" body="Create classes before inviting teachers or importing student records." action="Create first class" onClick={() => setFormOpen(true)} />}</section>
  </div>;
}

function TeachersPage({ teachers, classes, formOpen, setFormOpen, request, onInvite, onSaved }: {
  teachers: MemberRow[]; classes: ClassRow[]; formOpen: boolean; setFormOpen: (value: boolean) => void; request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onInvite: (value: Invitation) => void; onSaved: () => void;
}) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      const result = await request<{ teacher: { invitationCode: string; expiresAt: string }; assignment: unknown }>('/admin/teachers', { method: 'POST', body: JSON.stringify({
        displayName: String(form.get('displayName')).trim(), phoneE164: String(form.get('phoneE164')).replace(/\s/g, ''), classId: String(form.get('classId')),
        subjectCode: String(form.get('subjectCode')).trim().toUpperCase(), subjectName: String(form.get('subjectName')).trim(),
        canPublishResults: form.get('canPublishResults') === 'on', canPublishAnnouncements: form.get('canPublishAnnouncements') === 'on', canRecordAttendance: form.get('canRecordAttendance') === 'on',
      }) });
      onInvite({ code: result.teacher.invitationCode, phone: String(form.get('phoneE164')), role: 'Teacher', expiresAt: result.teacher.expiresAt });
      onSaved(); setFormOpen(false);
    } catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  return <div className="content-stack">
    {formOpen && <section className="section-card form-card"><div className="card-heading"><div><span className="eyebrow">TEACHER ONBOARDING</span><h3>Teacher profile & first assignment</h3></div><button className="icon-button" onClick={() => setFormOpen(false)}>×</button></div><form className="data-form" onSubmit={(event) => { void create(event); }}><label>Teacher name<input name="displayName" required placeholder="Full name" /></label><label>Mobile number<input name="phoneE164" required inputMode="tel" placeholder="+966 5X XXX XXXX" /></label><label>First class<select name="classId" required defaultValue=""><option value="" disabled>Select a class</option>{classes.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.classCode})</option>)}</select></label><label>Subject name<input name="subjectName" required placeholder="Mathematics" /></label><label>Subject code<input name="subjectCode" required placeholder="MATH" /></label><div className="form-divider">ASSIGNMENT PERMISSIONS</div><div className="permission-list"><label className="check-toggle"><input type="checkbox" name="canPublishResults" /> Publish class results</label><label className="check-toggle"><input type="checkbox" name="canPublishAnnouncements" defaultChecked /> Publish announcements</label><label className="check-toggle"><input type="checkbox" name="canRecordAttendance" defaultChecked /> Record attendance</label></div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="button primary" disabled={busy || classes.length === 0}>{busy ? 'Creating…' : 'Create teacher & assign'}</button></div></form>{error && <div className="alert danger">{error}</div>}</section>}
    <section className="section-card"><div className="card-heading"><div><span className="eyebrow">SCHOOL TEAM</span><h3>Teachers</h3></div><span className="subtle-count">{teachers.length} members</span></div>{teachers.length ? <div className="table-wrap"><table><thead><tr><th>Teacher</th><th>Mobile</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>{teachers.map((member) => <tr key={member.membershipId}><td><div className="table-person"><span className="person-avatar blue">{member.displayName.slice(0, 1)}</span><strong>{member.displayName}</strong></div></td><td>{member.phoneE164}</td><td>Teacher</td><td><StatusPill value={member.status} /></td><td><button className="text-button" onClick={async () => { try { const invite = await request<{ invitationCode: string; expiresAt: string }>(`/admin/members/${member.membershipId}/reissue-invitation`, { method: 'POST' }); onInvite({ code: invite.invitationCode, phone: member.phoneE164, role: 'Teacher', expiresAt: invite.expiresAt }); } catch (failure) { setError(displayError(failure)); } }}>Reissue invite</button></td></tr>)}</tbody></table></div> : <EmptyState title="No teachers invited yet" body={classes.length ? 'Invite your first teacher and attach a class assignment.' : 'Create a class before adding a teacher.'} action={classes.length ? 'Add a teacher' : 'Set up classes'} onClick={() => setFormOpen(true)} />}</section>
  </div>;
}

function StudentsPage({ students }: { students: StudentRow[] }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => students.filter((student) => `${student.displayName} ${student.admissionNumber} ${student.className}`.toLowerCase().includes(search.toLowerCase())), [students, search]);
  return <section className="section-card"><div className="card-heading"><div><span className="eyebrow">SCHOOL ROSTER</span><h3>{students.length} students</h3></div><span className="directory-search">⌕ <input placeholder="Search name or admission number" value={search} onChange={(event) => setSearch(event.target.value)} /></span></div>{students.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission number</th><th>Class</th><th>Linked guardians</th><th>Status</th></tr></thead><tbody>{filtered.map((student) => <tr key={student.id}><td><div className="table-person"><span className="person-avatar lilac">{student.displayName.slice(0, 1)}</span><strong>{student.displayName}</strong></div></td><td><code>{student.admissionNumber}</code></td><td>{student.className ?? '—'}</td><td>{student.guardianCount}</td><td><StatusPill value={student.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No students in the roster" body="Student and guardian accounts can be onboarded by the school through your existing student import workflow." />}{students.length > 0 && filtered.length === 0 && <div className="empty-inline">No students match “{search}”.</div>}</section>;
}

function ResultsPage({ students, request, onMessage }: {
  students: StudentRow[]; request: <T>(path: string, init?: RequestInit) => Promise<T>; onMessage: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState(''); const [rows, setRows] = useState<ResultRow[]>([]); const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [batchId, setBatchId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [published, setPublished] = useState<number | null>(null);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setPreview([]); setPublished(null); setFileName(file.name);
    try {
      const data = await parseResultsWorkbook(file);
      const result = await request<{ valid: boolean; rows: PreviewRow[] }>('/admin/results/import-preview', { method: 'POST', body: JSON.stringify({ rows: data }) });
      setRows(data); setPreview(result.rows); setBatchId(crypto.randomUUID());
    } catch (failure) { setRows([]); setPreview([]); setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!batchId || !preview.length || preview.some((row) => row.status !== 'READY')) return;
    if (!window.confirm(`Publish ${preview.length} private student result posts? Each result will be visible only to that student’s active linked guardians.`)) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ published: number }>('/admin/results/import-publish', { method: 'POST', body: JSON.stringify({ batchId, rows }) });
      setPublished(result.published); onMessage(`${result.published} result${result.published === 1 ? '' : 's'} published. Parents will see them in the child timeline after the event projection updates.`);
    } catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  const invalidCount = preview.filter((row) => row.status !== 'READY').length;
  return <div className="results-layout">
    <section className="section-card results-intro"><div className="results-icon">▤</div><span className="eyebrow">PRIVATE RESULTS DELIVERY</span><h3>Upload a spreadsheet. Publish to the right family.</h3><p>Each spreadsheet row becomes a separate result post for one student. The server matches the admission number to this school and only adds that student’s active guardians as recipients.</p><div className="privacy-note"><span>⌑</span><span>Marks are not included in push notifications. The workbook is parsed in this browser and is not uploaded or stored as a file.</span></div></section>
    <section className="section-card import-card"><div className="card-heading"><div><span className="eyebrow">STEP 1 · PREPARE</span><h3>Use the results template</h3></div><span className="step-number">01</span></div><p className="muted">One row per student and subject. Admission numbers must match the school roster exactly.</p><button className="button secondary" onClick={() => { void downloadResultsTemplate(); }}><span>↓</span> Download Excel template</button><div className="column-guide"><strong>Required columns</strong><p><code>admissionNumber</code> <code>examName</code> <code>subjectName</code> <code>marksObtained</code> <code>maxMarks</code></p><small>Optional: subjectCode, grade, remarks, resultDate</small></div></section>
    <section className="section-card import-card"><div className="card-heading"><div><span className="eyebrow">STEP 2 · REVIEW</span><h3>Choose your workbook</h3></div><span className="step-number">02</span></div><div className={`drop-zone ${fileName ? 'has-file' : ''}`} role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}><input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm" aria-label="Select results workbook" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} hidden /><span className="upload-icon">{fileName ? '✓' : '↑'}</span><strong>{fileName || 'Drop your Excel file here'}</strong><small>{fileName ? `${rows.length} spreadsheet rows parsed` : 'or click to browse · Excel workbook · up to 5 MB'}</small></div><div className="import-guardrails"><span>✓ Up to 200 rows</span><span>✓ Formula cells are rejected</span><span>✓ No raw workbook upload</span></div>{busy && <div className="progress-row"><div className="spinner small-spinner" /><span>{preview.length ? 'Publishing results…' : 'Reading workbook and checking roster…'}</span></div>}{error && <div className="alert danger">{error}</div>}{published !== null && <div className="alert success">Published {published} private result posts.</div>}</section>
    {preview.length > 0 && <section className="section-card preview-card"><div className="card-heading"><div><span className="eyebrow">STEP 3 · CONFIRM</span><h3>Import review</h3></div><div className="preview-summary"><span className="ready-count">{preview.length - invalidCount} ready</span>{invalidCount > 0 && <span className="invalid-count">{invalidCount} need attention</span>}</div></div><div className="preview-callout"><strong>{preview.length} individual result posts</strong><span>Every post is scoped to one student and the guardians linked to that student in this school.</span></div><div className="table-wrap preview-table"><table><thead><tr><th>Row</th><th>Student</th><th>Admission no.</th><th>Exam / subject</th><th>Score</th><th>Guardians</th><th>Validation</th></tr></thead><tbody>{preview.map((item) => <tr key={`${item.row}-${item.admissionNumber}`}><td>{item.row}</td><td>{item.studentName ?? '—'}</td><td><code>{item.admissionNumber}</code></td><td>{item.examName}<small className="table-subtitle">{item.subjectName}</small></td><td>{item.marksObtained} / {item.maxMarks}</td><td>{item.guardianCount}</td><td>{item.status === 'READY' ? <StatusPill value="READY" /> : <span className="row-error">{(item.error ?? 'INVALID').replaceAll('_', ' ').toLowerCase()}</span>}</td></tr>)}</tbody></table></div><div className="preview-footer"><div><strong>{students.length} students in roster</strong><small>Workbook row data remains in this browser until you leave this page.</small></div><button className="button primary" disabled={busy || invalidCount > 0 || published !== null} onClick={() => { void publish(); }}>{busy ? 'Publishing…' : published !== null ? 'Published' : `Publish ${preview.length} results`} <span>→</span></button></div></section>}
    <section className="result-flow"><span>Spreadsheet</span><i>→</i><span>School & roster validation</span><i>→</i><span>Private student posts</span><i>→</i><span>Kafka events</span><i>→</i><span>Parent timeline</span></section>
  </div>;
}

function StatusPill({ value }: { value: string }) {
  const tone = ['ACTIVE', 'READY', 'PUBLISHED'].includes(value) ? 'green' : ['SUSPENDED', 'REVOKED', 'INVALID', 'CLOSED'].includes(value) ? 'red' : 'amber';
  return <span className={`status-pill ${tone}`}><i />{value.toLowerCase().replaceAll('_', ' ')}</span>;
}

function EmptyState({ title, body, action, onClick }: { title: string; body: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><span className="empty-mark">✦</span><strong>{title}</strong><p>{body}</p>{action && onClick && <button className="button secondary" onClick={onClick}>{action} →</button>}</div>;
}
