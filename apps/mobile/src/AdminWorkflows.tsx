import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { colors } from './theme';
import { mobileApi, type ApiAssignment, type ApiLeaveRequest, type ApiMember, type ApiSchool, type ApiSchoolClass, type ApiStudent, type MobileSession } from './api';
import type { QueuedMutation } from './offline';

function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[style.button, disabled && style.disabled]}><Text style={style.buttonText}>{label}</Text></Pressable>;
}
function Field({ label, value, setValue, multiline = false }: { label: string; value: string; setValue: (value: string) => void; multiline?: boolean }) {
  return <View style={style.field}><Text style={style.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={setValue} multiline={multiline} autoCapitalize="none" style={[style.input, multiline && style.largeInput]} /></View>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={style.section}><Text style={style.title}>{title}</Text>{children}</View>;
}
function Row({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return <View style={style.row}><Text style={style.rowTitle}>{title}</Text>{detail ? <Text style={style.detail}>{detail}</Text> : null}<View style={style.actions}>{children}</View></View>;
}
function Toggle({ label, value, setValue }: { label: string; value: boolean; setValue: (value: boolean) => void }) {
  return <View style={style.toggle}><Text style={style.rowTitle}>{label}</Text><Switch value={value} onValueChange={setValue} /></View>;
}
const failureText = (error: unknown) => error instanceof Error ? error.message : 'Operation failed';

export function OwnerOperations({ session }: { session: MobileSession }) {
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const [owners, setOwners] = useState<ApiMember[]>([]);
  const [admins, setAdmins] = useState<ApiMember[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [schoolTimezone, setSchoolTimezone] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountPhone, setAccountPhone] = useState('');
  const [editing, setEditing] = useState<ApiMember | null>(null);
  const [audit, setAudit] = useState<Array<{ id: string; schoolId: string; action: string; occurredAt: string }>>([]);
  const [platformSummary, setPlatformSummary] = useState<Awaited<ReturnType<typeof mobileApi.platformSummary>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => {
    const [nextSchools, nextOwners] = await Promise.all([mobileApi.schools(session), mobileApi.platformOwners(session)]);
    setSchools(nextSchools); setOwners(nextOwners);
    const nextAdmins = schoolId ? await mobileApi.schoolAdmins(session, schoolId) : [];
    setAdmins(nextAdmins);
    setEditing((current) => current ? [...nextOwners,...nextAdmins].find((item) => item.membershipId === current.membershipId) ?? null : null);
  };
  useEffect(() => { void refresh().catch((error) => setMessage(failureText(error))); }, [session, schoolId]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage('');
    try { const result = await action(); await refresh(); setMessage(typeof result === 'string' ? result : success); }
    catch (error) { setMessage(failureText(error)); }
    finally { setBusy(false); }
  };
  const pickSchool = (school: ApiSchool) => { setSchoolId(school.id); setSchoolName(school.displayName); setSchoolTimezone(school.timezone); };
  return <>
    <Section title="Manage schools">
      {schools.map((school) => <Row key={school.id} title={school.displayName} detail={`${school.schoolCode} · ${school.status}`}><Button label="Manage" onPress={() => pickSchool(school)} /></Row>)}
      {schoolId ? <><Field label="School name" value={schoolName} setValue={setSchoolName} /><Field label="Timezone" value={schoolTimezone} setValue={setSchoolTimezone} />
        <Button label="Save school details" disabled={busy} onPress={() => { void run(() => mobileApi.updateSchool(session, schoolId, { displayName: schoolName, timezone: schoolTimezone }), 'School updated'); }} />
        <View style={style.actions}><Button label="Suspend" disabled={busy} onPress={() => { void run(() => mobileApi.updateSchool(session, schoolId, { status: 'SUSPENDED' }), 'School suspended'); }} /><Button label="Reactivate" disabled={busy} onPress={() => { void run(() => mobileApi.updateSchool(session, schoolId, { status: 'ACTIVE' }), 'School active'); }} /></View>
        <Text style={style.subtitle}>School administrators</Text>{admins.map((admin) => <Row key={admin.membershipId} title={admin.displayName} detail={`${admin.phoneE164} · ${admin.status}`}><Button label="Edit" onPress={() => { setEditing(admin); setAccountName(admin.displayName); setAccountPhone(admin.phoneE164); }} /><Button label="New invite" disabled={busy} onPress={() => { void run(async () => { const invite = await mobileApi.reissueSchoolAdmin(session, schoolId, admin.membershipId); return `Invitation: ${invite.invitationCode}`; }, 'Invitation reissued'); }} /></Row>)}
        <Text style={style.subtitle}>Add school administrator</Text><Field label="Administrator name" value={accountName} setValue={setAccountName} /><Field label="Administrator mobile" value={accountPhone} setValue={setAccountPhone} /><Button label="Add administrator" disabled={busy} onPress={() => { void run(async () => { const account = await mobileApi.createSchoolAdmin(session, schoolId, { displayName: accountName, phoneE164: accountPhone }); return `Invitation: ${account.invitationCode}`; }, 'Administrator added'); }} />
      </> : null}
    </Section>
    <Section title="Platform owners">
      {owners.map((owner) => <Row key={owner.membershipId} title={owner.displayName} detail={`${owner.phoneE164} · ${owner.status}`}><Button label="Edit" onPress={() => { setEditing(owner); setAccountName(owner.displayName); setAccountPhone(owner.phoneE164); }} /><Button label="New invite" disabled={busy} onPress={() => { void run(async () => { const invite = await mobileApi.reissuePlatformOwner(session, owner.membershipId); return `Invitation: ${invite.invitationCode}`; }, 'Invitation reissued'); }} /></Row>)}
      <Field label="New owner name" value={accountName} setValue={setAccountName} /><Field label="New owner mobile" value={accountPhone} setValue={setAccountPhone} />
      <Button label="Add platform owner" disabled={busy} onPress={() => { void run(async () => { const account = await mobileApi.createPlatformOwner(session, { displayName: accountName, phoneE164: accountPhone }); return `Invitation: ${account.invitationCode}`; }, 'Owner added'); }} />
    </Section>
    {editing ? <Section title={`Edit ${editing.role.toLowerCase().replaceAll('_',' ')}`}><Field label="Account name" value={accountName} setValue={setAccountName} /><Field label="Mobile" value={accountPhone} setValue={setAccountPhone} />
      <Button label="Save account" disabled={busy} onPress={() => { void run(() => editing.role === 'PLATFORM_OWNER'
        ? mobileApi.updatePlatformOwner(session, editing.membershipId, { displayName: accountName, phoneE164: accountPhone })
        : mobileApi.updateSchoolAdmin(session, schoolId, editing.membershipId, { displayName: accountName, phoneE164: accountPhone }), 'Account updated'); }} />
      <Button label={editing.status === 'ACTIVE' ? 'Deactivate account' : 'Reactivate account'} disabled={busy} onPress={() => { void run(() => editing.role === 'PLATFORM_OWNER'
        ? mobileApi.updatePlatformOwner(session, editing.membershipId, { status: editing.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' })
        : mobileApi.updateSchoolAdmin(session, schoolId, editing.membershipId, { status: editing.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' }), 'Account status updated'); }} />
    </Section> : null}
    <Section title="Cross school reports"><Button label="Load school summary" disabled={busy} onPress={() => { void run(async () => { setPlatformSummary(await mobileApi.platformSummary(session)); }, 'Summary loaded'); }} />
      {platformSummary ? <><Text style={style.rowTitle}>{platformSummary.activeSchoolCount} active of {platformSummary.schoolCount} schools</Text>{platformSummary.schools.map((item) => <Row key={item.schoolId} title={`${item.displayName} · ${item.status}`} detail={`${item.activeStudentCount} students · ${item.activeTeacherCount} teachers · ${item.activeParentCount} parents · ${item.activeAdminCount} admins`} />)}</> : null}
      <Button label="Load recent audit" disabled={busy} onPress={() => { void run(async () => { setAudit(await mobileApi.auditReport(session)); }, 'Audit loaded'); }} />{audit.slice(0, 20).map((item) => <Row key={item.id} title={item.action} detail={`${schools.find((school) => school.id === item.schoolId)?.displayName ?? 'Platform'} · ${new Date(item.occurredAt).toLocaleString()}`} />)}</Section>
    {busy ? <ActivityIndicator color={colors.primary} /> : null}{message ? <Text style={style.message}>{message}</Text> : null}
  </>;
}

export function SchoolOperations({ session, classes, onClassesChanged }: { session: MobileSession; classes: ApiSchoolClass[]; onClassesChanged: () => void }) {
  const [teachers, setTeachers] = useState<ApiMember[]>([]);
  const [parents, setParents] = useState<ApiMember[]>([]);
  const [students, setStudents] = useState<ApiStudent[]>([]);
  const [assignments, setAssignments] = useState<ApiAssignment[]>([]);
  const [leaves, setLeaves] = useState<ApiLeaveRequest[]>([]);
  const [selectedMember, setSelectedMember] = useState<ApiMember | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<ApiStudent | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<ApiAssignment | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [classId, setClassId] = useState('');
  const [guardianUserId, setGuardianUserId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ count: number; valid: boolean; rows: Array<{ row: number; admissionNumber: string; classCode: string; classId: string | null }> } | null>(null);
  const [fromYear, setFromYear] = useState('2026-2027');
  const [toYear, setToYear] = useState('2027-2028');
  const [reviewNote, setReviewNote] = useState('');
  const [correctionClassId, setCorrectionClassId] = useState('');
  const [correctionDate, setCorrectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [correctionVersion, setCorrectionVersion] = useState(0);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionRows, setCorrectionRows] = useState<Array<{ studentId: string; displayName: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' }>>([]);
  const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof mobileApi.adminSummary>> | null>(null);
  const [audit, setAudit] = useState<Array<{ id: string; schoolId: string; action: string; occurredAt: string }>>([]);
  const [scheduled, setScheduled] = useState(false);
  const [schoolWide, setSchoolWide] = useState(false);
  const [gradeWide, setGradeWide] = useState(false);
  const [urgentEnabled, setUrgentEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => {
    const [nextTeachers, nextParents, nextStudents, nextLeaves] = await Promise.all([
      mobileApi.adminTeachers(session), mobileApi.adminParents(session), mobileApi.adminStudents(session), mobileApi.leaveRequests(session),
    ]);
    setTeachers(nextTeachers); setParents(nextParents); setStudents(nextStudents); setLeaves(nextLeaves);
    setSelectedMember((current) => current ? [...nextTeachers,...nextParents].find((item) => item.membershipId === current.membershipId) ?? null : null);
    setSelectedStudent((current) => current ? nextStudents.find((item) => item.id === current.id) ?? null : null);
    if (selectedMember?.role === 'TEACHER') {
      const nextAssignments = await mobileApi.teacherAssignments(session, selectedMember.membershipId);
      setAssignments(nextAssignments);
      setSelectedAssignment((current) => current ? nextAssignments.find((item) => item.assignmentId === current.assignmentId) ?? null : null);
    }
  };
  useEffect(() => { void refresh().catch((error) => setMessage(failureText(error))); void mobileApi.context(session).then((context) => {
    setScheduled(Boolean(context.school?.scheduledAnnouncementsEnabled)); setSchoolWide(Boolean(context.school?.schoolWideAnnouncementsEnabled)); setGradeWide(Boolean(context.school?.gradeWideAnnouncementsEnabled));
    setUrgentEnabled(Boolean(context.school?.urgentAnnouncementsEnabled));
  }).catch(() => undefined); }, [session]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage('');
    try { const result = await action(); await refresh(); setMessage(typeof result === 'string' ? result : success); }
    catch (error) { setMessage(failureText(error)); }
    finally { setBusy(false); }
  };
  const chooseMember = (member: ApiMember) => { setSelectedMember(member); setName(member.displayName); setPhone(member.phoneE164); if (member.role === 'TEACHER') void mobileApi.teacherAssignments(session, member.membershipId).then(setAssignments).catch((error) => setMessage(failureText(error))); };
  const chooseStudent = (student: ApiStudent) => { setSelectedStudent(student); setName(student.displayName); setClassId(student.classId); };
  const pickCsv = async () => { const file = await DocumentPicker.getDocumentAsync({ type: 'text/csv', copyToCacheDirectory: true }); if (!file.canceled) setCsv(await fetch(file.assets[0]!.uri).then((response) => response.text())); };
  return <>
    <Section title="Manage teachers and parents">
      {[...teachers, ...parents].map((member) => <Row key={member.membershipId} title={member.displayName} detail={`${member.role} · ${member.phoneE164} · ${member.status}`}><Button label="Manage" onPress={() => chooseMember(member)} /><Button label="Invite" disabled={busy} onPress={() => { void run(async () => { const invite = await mobileApi.reissueInvitation(session, member.membershipId); return `Invitation: ${invite.invitationCode}`; }, 'Invitation reissued'); }} /></Row>)}
      {selectedMember ? <><Text style={style.subtitle}>Editing {selectedMember.displayName}</Text><Field label="Name" value={name} setValue={setName} /><Field label="Mobile" value={phone} setValue={setPhone} /><Button label="Save account" disabled={busy} onPress={() => { void run(() => mobileApi.updateMember(session, selectedMember.membershipId, { displayName: name, phoneE164: phone }), 'Account updated'); }} /><Button label={selectedMember.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} disabled={busy} onPress={() => { void run(() => mobileApi.updateMember(session, selectedMember.membershipId, { status: selectedMember.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' }), 'Account status updated'); }} />
        {selectedMember.role === 'TEACHER' ? <><Text style={style.subtitle}>Assignments</Text>{assignments.map((assignment) => <Row key={assignment.assignmentId} title={`${assignment.className} · ${assignment.subjectName}`} detail={assignment.status}><Button label="Edit assignment" onPress={() => { setSelectedAssignment(assignment); setClassId(assignment.classId); }} /></Row>)}</> : null}
      </> : null}
      {selectedAssignment ? <><Text style={style.subtitle}>Reassign teacher</Text>{classes.map((schoolClass) => <Button key={schoolClass.id} label={`${classId === schoolClass.id ? '✓ ' : ''}${schoolClass.displayName}`} onPress={() => setClassId(schoolClass.id)} />)}
        <Toggle label="School wide announcements" value={selectedAssignment.canPublishSchoolWide} setValue={(value) => setSelectedAssignment({ ...selectedAssignment, canPublishSchoolWide: value })} />
        <Toggle label="Grade wide announcements" value={selectedAssignment.canPublishGradeWide} setValue={(value) => setSelectedAssignment({ ...selectedAssignment, canPublishGradeWide: value })} />
        <Toggle label="Urgent announcements" value={selectedAssignment.canPublishUrgent} setValue={(value) => setSelectedAssignment({ ...selectedAssignment, canPublishUrgent: value })} />
        <Button label="Save assignment" disabled={busy} onPress={() => { void run(() => mobileApi.updateAssignment(session, selectedAssignment.assignmentId, { classId, canPublishSchoolWide: selectedAssignment.canPublishSchoolWide, canPublishGradeWide: selectedAssignment.canPublishGradeWide,canPublishUrgent: selectedAssignment.canPublishUrgent }), 'Assignment saved'); }} />
        <Button label={selectedAssignment.status === 'ACTIVE' ? 'Revoke assignment' : 'Restore assignment'} disabled={busy} onPress={() => { void run(() => mobileApi.updateAssignment(session, selectedAssignment.assignmentId, { status: selectedAssignment.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' }), 'Assignment status updated'); }} />
      </> : null}
    </Section>
    <Section title="Manage students and guardian links">
      {students.map((student) => <Row key={student.id} title={student.displayName} detail={`${student.admissionNumber} · ${student.className ?? 'No class'} · ${student.status}`}><Button label="Manage" onPress={() => chooseStudent(student)} /></Row>)}
      {selectedStudent ? <><Field label="Student name" value={name} setValue={setName} />{classes.map((schoolClass) => <Button key={schoolClass.id} label={`${classId === schoolClass.id ? '✓ ' : ''}${schoolClass.displayName}`} onPress={() => setClassId(schoolClass.id)} />)}
        <Button label="Save name and class" disabled={busy} onPress={() => { void run(() => mobileApi.updateStudent(session, selectedStudent.id, { displayName: name, classId }), 'Student updated'); }} />
        <Button label={selectedStudent.status === 'ACTIVE' ? 'Deactivate student' : 'Reactivate student'} disabled={busy} onPress={() => { void run(() => mobileApi.updateStudent(session, selectedStudent.id, { status: selectedStudent.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', classId }), 'Student status updated'); }} />
        <Text style={style.subtitle}>Guardian link</Text>{parents.map((parent) => <Button key={parent.userId} label={`${parent.displayName} · ${parent.phoneE164}`} onPress={() => setGuardianUserId(parent.userId)} />)}
        <Text style={style.detail}>Selected guardian: {parents.find((parent) => parent.userId === guardianUserId)?.displayName ?? 'none'}</Text>
        <Button label="Link guardian" disabled={busy || !guardianUserId} onPress={() => { void run(() => mobileApi.linkGuardian(session, selectedStudent.id, guardianUserId, true), 'Guardian linked'); }} />
        <Button label="Remove guardian link" disabled={busy || !guardianUserId} onPress={() => { void run(() => mobileApi.linkGuardian(session, selectedStudent.id, guardianUserId, false), 'Guardian link removed'); }} />
      </> : null}
    </Section>
    <Section title="Bulk student and parent import">
      <Text style={style.detail}>CSV columns: studentDisplayName, admissionNumber, classCode, parentDisplayName, parentPhoneE164, relationship</Text>
      <Button label="Choose CSV file" onPress={() => { void pickCsv().catch((error) => setMessage(failureText(error))); }} />
      <Field label="CSV preview" value={csv} setValue={setCsv} multiline />
      <Button label="Validate import" disabled={busy || !csv.trim()} onPress={() => { void run(async () => { const result = await mobileApi.previewStudentCsv(session, csv); setPreview(result); return `${result.count} rows checked. ${result.valid ? 'Ready to import.' : 'Fix class codes before import.'}`; }, 'Preview ready'); }} />
      {preview ? <><Text style={style.detail}>{preview.count} rows · {preview.valid ? 'all class codes valid' : 'some classes missing'}</Text>{preview.rows.slice(0, 5).map((row) => <Text key={row.row} style={style.detail}>Row {row.row}: {row.admissionNumber} → {row.classCode}{row.classId ? '' : ' (missing)'}</Text>)}</> : null}
      <Button label="Import validated rows" disabled={busy || !preview?.valid} onPress={() => { void run(async () => { const result = await mobileApi.importStudentCsv(session, csv); return `${result.imported} imported, ${result.failed} failed. ${result.results.filter((row) => row.invitationCode).map((row) => `Row ${row.row}: ${row.invitationCode}`).join(' · ')}`; }, 'Import complete'); }} />
    </Section>
    <Section title="Academic year rollover"><Field label="Current academic year" value={fromYear} setValue={setFromYear} /><Field label="New academic year" value={toYear} setValue={setToYear} /><Text style={style.detail}>Copies active classes, enrollments and teacher assignments, then archives the previous classes.</Text><Button label="Roll over academic year" disabled={busy} onPress={() => { void run(async () => { const result = await mobileApi.rolloverAcademicYear(session, fromYear, toYear); onClassesChanged(); return `${result.classesCreated} classes rolled over`; }, 'Academic year updated'); }} /></Section>
    <Section title="Publishing permissions"><Toggle label="Scheduled announcements" value={scheduled} setValue={setScheduled} /><Toggle label="School wide announcements" value={schoolWide} setValue={setSchoolWide} /><Toggle label="Grade wide announcements" value={gradeWide} setValue={setGradeWide} /><Toggle label="Urgent announcements" value={urgentEnabled} setValue={setUrgentEnabled} /><Button label="Save publishing settings" disabled={busy} onPress={() => { void run(() => mobileApi.updateConfiguration(session, { scheduledAnnouncementsEnabled: scheduled, schoolWideAnnouncementsEnabled: schoolWide, gradeWideAnnouncementsEnabled: gradeWide,urgentAnnouncementsEnabled: urgentEnabled }), 'Publishing settings saved'); }} /></Section>
    <Section title="Leave requests">{leaves.map((leave) => <Row key={leave.id} title={`${leave.studentName} · ${leave.status}`} detail={`${leave.attendanceDate} · ${leave.reason ?? 'No reason'}`}><Button label="Approve" disabled={busy || leave.status !== 'PENDING'} onPress={() => { void run(() => mobileApi.reviewLeave(session, leave.id, 'APPROVED', reviewNote), 'Leave approved'); }} /><Button label="Reject" disabled={busy || leave.status !== 'PENDING'} onPress={() => { void run(() => mobileApi.reviewLeave(session, leave.id, 'REJECTED', reviewNote), 'Leave rejected'); }} /></Row>)}<Field label="Review note" value={reviewNote} setValue={setReviewNote} multiline /></Section>
    <Section title="Attendance escalation"><Text style={style.detail}>School administrators can correct submitted attendance after the teacher edit window. Every correction needs a reason and creates a new version.</Text>
      <Field label="Attendance date (YYYY-MM-DD)" value={correctionDate} setValue={setCorrectionDate} />
      {classes.map((schoolClass) => <Button key={schoolClass.id} label={`${correctionClassId === schoolClass.id ? '✓ ' : ''}${schoolClass.displayName}`} onPress={() => { setCorrectionClassId(schoolClass.id); setCorrectionRows([]); }} />)}
      <Button label="Load submitted attendance" disabled={busy || !correctionClassId} onPress={() => { void run(async () => { const context = await mobileApi.adminCorrectionContext(session, correctionClassId, correctionDate); setCorrectionVersion(context.version); if (!context.version || context.current.length !== context.roster.length) { setCorrectionRows([]); return context.version ? 'Roster changed since submission; resolve the roster before correcting.' : 'No submitted attendance for this class and date'; } setCorrectionRows(context.roster.map((student) => ({ studentId: student.id, displayName: student.displayName, status: context.current.find((item) => item.studentId === student.id)!.status }))); return `Version ${context.version} loaded`; }, 'Attendance loaded'); }} />
      {correctionRows.map((row) => <Row key={row.studentId} title={row.displayName} detail={row.status}><Button label="Change status" onPress={() => { const statuses = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const; setCorrectionRows((items) => items.map((item) => item.studentId === row.studentId ? { ...item, status: statuses[(statuses.indexOf(item.status) + 1) % statuses.length]! } : item)); }} /></Row>)}
      {correctionRows.length ? <><Field label="Correction reason (at least 10 characters)" value={correctionReason} setValue={setCorrectionReason} multiline /><Button label="Submit administrator correction" disabled={busy || correctionVersion < 1 || correctionReason.trim().length < 10} onPress={() => { void run(async () => { const result = await mobileApi.adminCorrectAttendance(session, { classId: correctionClassId, attendanceDate: correctionDate, expectedVersion: correctionVersion, correctionReason, idempotencyKey: Crypto.randomUUID(), rows: correctionRows.map(({ studentId, status }) => ({ studentId, status })) }); setCorrectionVersion(result.version); return `Attendance corrected as version ${result.version}`; }, 'Correction saved'); }} /></> : null}
    </Section>
    <Section title="Reports and audit"><Field label="From date (YYYY-MM-DD)" value={reportFrom} setValue={setReportFrom} /><Field label="To date (YYYY-MM-DD)" value={reportTo} setValue={setReportTo} /><Button label="Load summary" disabled={busy} onPress={() => { void run(async () => { setSummary(await mobileApi.adminSummary(session, reportFrom, reportTo)); }, 'Summary loaded'); }} />
      {summary ? <><Text style={style.rowTitle}>{summary.studentCount} students · {summary.teacherCount} teachers</Text>{summary.attendance.map((item) => <Text key={`${item.classId}:${item.status}`} style={style.detail}>{classes.find((schoolClass) => schoolClass.id === item.classId)?.displayName ?? 'Class'}: {item.status} {item.count}</Text>)}{summary.notifications.map((item) => <Text key={item.notificationType} style={style.detail}>{item.notificationType}: {item.count} notices · {item.readCount} read</Text>)}</> : null}
      <Button label="Load audit trail" disabled={busy} onPress={() => { void run(async () => { setAudit(await mobileApi.auditReport(session)); }, 'Audit loaded'); }} />{audit.slice(0, 20).map((item) => <Text key={item.id} style={style.detail}>{item.action} · {new Date(item.occurredAt).toLocaleString()}</Text>)}
    </Section>
    {busy ? <ActivityIndicator color={colors.primary} /> : null}{message ? <Text style={style.message} selectable>{message}</Text> : null}
  </>;
}

export function OfflineQueuePanel({ session }: { session: MobileSession }) {
  const [items, setItems] = useState<QueuedMutation[]>([]);
  const [reviewing, setReviewing] = useState<QueuedMutation | null>(null);
  const [message, setMessage] = useState('');
  const refresh = () => { void mobileApi.queuedMutations(session).then((queued) => setItems(queued.filter((item)=>item.membershipId===(session.activeMembershipId ?? session.memberships[0]?.id)))).catch((error) => setMessage(failureText(error))); };
  useEffect(refresh, [session]);
  return <Section title="Offline changes"><Text style={style.detail}>Changes are retried only for the same account, school and role. A conflict pauses later changes. Review it, discard it, reload server data, and submit a fresh correction.</Text>
    <Button label="Sync pending changes" onPress={() => { void mobileApi.syncOfflineQueue(session).then((result) => { setMessage(`${result.completed} synced, ${result.remaining} remaining`); refresh(); }).catch((error) => setMessage(failureText(error))); }} />
    {items.map((item) => <Row key={item.id} title={`${item.path.split('/')[1]} · ${item.state}`} detail={`${new Date(item.createdAt).toLocaleString()}${item.error ? ` · ${item.error}` : ''}`}><Button label="Review" onPress={()=>setReviewing(item)} /><Button label="Discard" onPress={() => { void mobileApi.discardQueuedMutation(session, item.id).then(()=>{ setReviewing(null); refresh(); }).catch((error) => setMessage(failureText(error))); }} /></Row>)}
    {reviewing ? <Text style={style.detail} selectable>{JSON.stringify(reviewing.body,null,2)}</Text> : null}
    {!items.length ? <Text style={style.detail}>No pending offline changes.</Text> : null}{message ? <Text style={style.message}>{message}</Text> : null}
  </Section>;
}

const style = StyleSheet.create({
  section: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', padding: 16, gap: 9, marginTop: 18 },
  title: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: colors.ink },
  subtitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: colors.ink, marginTop: 8 },
  field: { gap: 5 }, label: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: colors.ink },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 42, fontFamily: 'Poppins_400Regular', color: colors.ink },
  largeInput: { minHeight: 120, textAlignVertical: 'top' },
  row: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 9, gap: 4 }, rowTitle: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.ink },
  detail: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: colors.primarySoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start' },
  buttonText: { fontFamily: 'Poppins_600SemiBold', color: colors.primary, fontSize: 11 },
  disabled: { opacity: 0.45 }, toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  message: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: colors.primary, marginTop: 14 },
});
