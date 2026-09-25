import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Home,
  Megaphone,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
  WifiOff,
  X,
} from 'lucide-react-native';
import { useFonts } from 'expo-font';
import { AttendanceStatus, Child, children, PostType, posts, Role, Route, scopedTimeline, TabKey, TimelinePost } from './src/domain';
import { colors, radius } from './src/theme';
import { clearSession, demoMode, loadSession, mobileApi, MobileSession, requestOtp, saveSession, verifyOtp, type ApiSchool, type ApiSchoolClass, type ApiTeacherPost, type ApiTeachingAssignment } from './src/api';
import PoppinsRegular from './assets/fonts/Poppins-Regular.ttf';
import PoppinsMedium from './assets/fonts/Poppins-Medium.ttf';
import PoppinsSemiBold from './assets/fonts/Poppins-SemiBold.ttf';
import PoppinsBold from './assets/fonts/Poppins-Bold.ttf';

const postLabels: Record<PostType, string> = { HOMEWORK: 'Homework', RESULT: 'Result', ANNOUNCEMENT: 'Announcement' };
const postIcons = { HOMEWORK: BookOpen, RESULT: GraduationCap, ANNOUNCEMENT: Megaphone };
const roleLabels: Record<Role, string> = { PLATFORM_OWNER: 'Platform Owner', SCHOOL_ADMIN: 'School Admin', TEACHER: 'Teacher', PARENT: 'Parent' };
const createIdempotencyKey = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
  const random = Math.floor(Math.random() * 16);
  const value = character === 'x' ? random : (random & 0x3) | 0x8;
  return value.toString(16);
});

function PrimaryButton({ label, onPress, disabled, loading, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; secondary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, (disabled || loading) && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}>
      {loading ? <ActivityIndicator color={secondary ? colors.primary : '#fff'} /> : <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{label}</Text>}
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, required, error }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; required?: boolean; error?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#A7A3AE" multiline={multiline} style={[styles.input, multiline && styles.textarea, error && styles.inputError]} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function Header({ title, subtitle, onBack, action }: { title: string; subtitle?: string; onBack?: () => void; action?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.iconButton}><ArrowLeft size={22} color={colors.ink} /></Pressable> : <View style={styles.brandMark}><GraduationCap size={22} color="#fff" /></View>}
        <View style={styles.headerText}><Text style={styles.headerTitle}>{title}</Text>{subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}</View>
        {action ?? <View style={styles.iconPlaceholder} />}
      </View>
    </View>
  );
}

function Chip({ label, tone = 'purple' }: { label: string; tone?: 'purple' | 'warning' | 'success' | 'danger' | 'info' }) {
  const toneStyle = tone === 'warning' ? styles.chipWarning : tone === 'success' ? styles.chipSuccess : tone === 'danger' ? styles.chipDanger : tone === 'info' ? styles.chipInfo : styles.chipPurple;
  return <View style={[styles.chip, toneStyle]}><Text style={[styles.chipText, toneStyle]}>{label}</Text></View>;
}

function EmptyState({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Icon size={34} color={colors.primary} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

function LoginScreen({ onSignedIn }: { onSignedIn: (role: Role, session?: MobileSession) => void }) {
  const [phase, setPhase] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('+91 98765 43210');
  const [invitation, setInvitation] = useState('PARENT-INVITE');
  const [otp, setOtp] = useState('123456');
  const [challengeId, setChallengeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const submit = async () => {
    setLoading(true);
    setServerError('');
    try {
      if (phase === 'phone') {
        if (demoMode) await new Promise((resolve) => setTimeout(resolve, 450));
        else {
          const challenge = await requestOtp(phone, invitation);
          setChallengeId(challenge.challengeId);
        }
        setPhase('otp');
      } else if (demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        onSignedIn('PARENT');
      } else {
        const session = await verifyOtp(challengeId, otp);
        await saveSession(session);
        onSignedIn(session.memberships[0]?.role ?? 'PARENT', session);
      }
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to sign in. Please retry.');
    } finally { setLoading(false); }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.login} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.loginHero}><View style={styles.loginLogo}><GraduationCap size={42} color="#fff" /></View><Text style={styles.loginTitle}>Welcome to SchoolConnect</Text><Text style={styles.loginBody}>One secure place for school updates, homework and attendance.</Text></View>
        <View style={styles.loginCard}>
          <Text style={styles.sectionTitle}>{phase === 'phone' ? 'Sign in with mobile' : 'Enter your OTP code here'}</Text>
          <Text style={styles.helper}>{phase === 'phone' ? 'Use the mobile number from your school invitation.' : `We sent a six-digit code to ${phone}.`}</Text>
          {phase === 'phone' ? <><Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="+91" required /><Field label="Invitation code" value={invitation} onChangeText={setInvitation} placeholder="School invitation" required /></> : <Field label="Verification code" value={otp} onChangeText={setOtp} placeholder="6-digit code" required />}
          {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}
          <PrimaryButton label={phase === 'phone' ? 'Send OTP' : 'Verify and continue'} onPress={() => { void submit(); }} loading={loading} disabled={phase === 'phone' ? phone.length < 8 || !invitation.trim() : otp.length !== 6} />
          {phase === 'otp' ? <Pressable onPress={() => setPhase('phone')}><Text style={styles.link}>Change mobile number</Text></Pressable> : null}
          <View style={styles.securityNote}><ShieldCheck size={18} color={colors.primary} /><Text style={styles.securityText}>Your role and school access are resolved securely after sign-in.</Text></View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OfflineBanner() {
  return <View style={styles.offline}><WifiOff size={16} color={colors.warning} /><Text style={styles.offlineText}>Offline view · showing recent permitted content</Text></View>;
}

function TeacherHome({ navigate, publishedPosts, teacherName = 'Ms. Priya', assignment }: { navigate: (route: Route) => void; publishedPosts?: ApiTeacherPost[]; teacherName?: string; assignment?: ApiTeachingAssignment }) {
  const className = assignment?.className ?? 'No active class';
  const subjectName = assignment?.subjectName ?? 'Ask the school administrator for an assignment';
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title={`Hello, ${teacherName}`} subtitle={`${className} · ${subjectName}`} action={<Pressable style={styles.iconButton}><Bell size={22} color={colors.primary} /></Pressable>} />
      <View style={styles.scopeCard}><View><Text style={styles.eyebrow}>ACTIVE CLASS</Text><Text style={styles.scopeTitle}>{className}</Text><Text style={styles.scopeMeta}>{subjectName}</Text></View><ChevronDown size={20} color={colors.primary} /></View>
      <Text style={styles.sectionTitle}>Quick actions</Text>
      <View style={styles.quickGrid}>
        {assignment ? <QuickAction icon={BookOpen} label="Homework" onPress={() => navigate({ name: 'compose', type: 'HOMEWORK' })} /> : null}
        {assignment?.canPublishResults ? <QuickAction icon={GraduationCap} label="Results" onPress={() => navigate({ name: 'compose', type: 'RESULT' })} /> : null}
        {assignment?.canPublishAnnouncements ? <QuickAction icon={Megaphone} label="Announcement" onPress={() => navigate({ name: 'compose', type: 'ANNOUNCEMENT' })} /> : null}
        {assignment?.canRecordAttendance ? <QuickAction icon={ClipboardCheck} label="Attendance" onPress={() => navigate({ name: 'teacher-attendance' })} /> : null}
      </View>
      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Today</Text><Pressable onPress={() => navigate({ name: 'follow-ups' })}><Text style={styles.linkInline}>View follow-ups</Text></Pressable></View>
      <Pressable onPress={() => navigate({ name: 'follow-ups' })} style={styles.actionCard}><View style={styles.actionIcon}><CircleAlert size={23} color={colors.warning} /></View><View style={styles.flex}><Text style={styles.cardTitle}>3 absence follow-ups</Text><Text style={styles.cardBody}>Two guardians have not acknowledged.</Text></View><ChevronRight size={20} color={colors.muted} /></Pressable>
      <Text style={styles.sectionTitle}>Recent publishing</Text>
      {publishedPosts === undefined ? <><ActivityRow type="HOMEWORK" title="Fractions practice" meta="Published · 28 recipients" /><ActivityRow type="ANNOUNCEMENT" title="Holiday announcement" meta="Updated · 31 viewed" /><ActivityRow type="RESULT" title="Midyear results" meta="Published · Private files" /></> : publishedPosts.length ? publishedPosts.slice(0, 5).map((post) => <ActivityRow key={post.id} type={post.postType} title={post.title} meta={`${post.status === 'UPDATED' ? 'Updated' : 'Published'} · ${post.recipientCount} recipients`} onPress={() => navigate({ name: 'edit-post', postId: post.id })} />) : <EmptyState icon={BookOpen} title="Nothing published yet" body="Your published homework and announcements will appear here." />}
    </ScrollView>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.cardPressed]}><View style={styles.quickIcon}><Icon size={23} color={colors.primary} /></View><Text style={styles.quickLabel}>{label}</Text></Pressable>;
}

function ActivityRow({ type, title, meta, onPress }: { type: PostType; title: string; meta: string; onPress?: () => void }) {
  const Icon = postIcons[type];
  return <Pressable onPress={onPress} style={styles.listRow}><View style={styles.listIcon}><Icon size={20} color={colors.primary} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardMeta}>{meta}</Text></View><ChevronRight size={19} color={colors.muted} /></Pressable>;
}

function ParentHome({ childId, setChildId, navigate, offline, availableChildren = children, feed }: { childId: string; setChildId: (id: string) => void; navigate: (route: Route) => void; offline: boolean; availableChildren?: Child[]; feed?: TimelinePost[] }) {
  const selected = availableChildren.find((child) => child.id === childId) ?? availableChildren[0];
  if (!selected) return <ScrollView contentContainerStyle={styles.page}><Header title="Welcome" subtitle="Loading your school context" /><EmptyState icon={Users} title="No linked children" body="Ask the school to verify your guardian invitation and child link." /></ScrollView>;
  const timeline = feed ?? scopedTimeline(selected.id);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Welcome, Ahmed" subtitle="Here’s what’s new today" action={<Pressable style={styles.iconButton}><Bell size={22} color={colors.primary} /></Pressable>} />
      {offline ? <OfflineBanner /> : null}
      <Text style={styles.eyebrow}>SELECTED CHILD</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childSwitchRow}>
        {availableChildren.map((child) => <Pressable key={child.id} onPress={() => setChildId(child.id)} accessibilityLabel={`${child.name}, ${child.id === selected.id ? 'selected' : 'not selected'}`} style={[styles.childPill, child.id === selected.id && styles.childPillActive]}><View style={[styles.avatarSmall, child.id === selected.id && styles.avatarSmallActive]}><Text style={[styles.avatarText, child.id === selected.id && styles.avatarTextActive]}>{child.avatar}</Text></View><View><Text style={[styles.childName, child.id === selected.id && styles.childNameActive]}>{child.name}</Text><Text style={[styles.childClass, child.id === selected.id && styles.childClassActive]}>{child.className}</Text></View></Pressable>)}
      </ScrollView>
      <View style={styles.childSummary}><View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{selected.avatar}</Text></View><View style={styles.flex}><Text style={styles.scopeTitle}>{selected.name}</Text><Text style={styles.scopeMeta}>{selected.school}</Text></View></View>
      {selected.id === 'child-jenny' ? <Pressable onPress={() => navigate({ name: 'absence', eventId: 'attendance-1' })} style={styles.actionCard}><View style={styles.actionIcon}><CircleAlert size={23} color={colors.warning} /></View><View style={styles.flex}><View style={styles.inline}><Text style={styles.cardTitle}>Absence needs attention</Text><Chip label="Pending" tone="warning" /></View><Text style={styles.cardBody}>Today · Tap to acknowledge or add a reason</Text></View><ChevronRight size={20} color={colors.muted} /></Pressable> : null}
      <Text style={styles.sectionTitle}>Today</Text>
      {timeline.length ? timeline.map((post) => <TimelineCard key={post.id} post={post} onPress={() => navigate({ name: 'post-detail', postId: post.id })} />) : <EmptyState icon={BookOpen} title="No updates yet" body="School updates for this child will appear here." />}
    </ScrollView>
  );
}

function TimelineCard({ post, onPress }: { post: (typeof posts)[number]; onPress: () => void }) {
  const Icon = postIcons[post.type];
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.timelineCard, pressed && styles.cardPressed]}><View style={styles.timelineHead}><View style={styles.listIcon}><Icon size={20} color={colors.primary} /></View><View style={styles.flex}><View style={styles.inline}><Text style={styles.cardEyebrow}>{postLabels[post.type]}</Text>{post.updated ? <Chip label="Updated" tone="info" /> : null}{post.unread ? <View style={styles.unreadDot} /> : null}</View><Text style={styles.cardTitleLarge}>{post.title}</Text></View><Text style={styles.cardTime}>{post.timestamp}</Text></View><Text style={styles.cardBody}>{post.body}</Text><View style={styles.timelineFoot}><Text style={styles.cardMeta}>{post.subject ?? post.author}{post.dueDate ? ` · Due ${post.dueDate}` : ''}</Text><ChevronRight size={18} color={colors.muted} /></View></Pressable>;
}

function PostsScreen({ role, childId, navigate, feed, publishedPosts, assignment }: { role: Role; childId: string; navigate: (route: Route) => void; feed?: TimelinePost[]; publishedPosts?: ApiTeacherPost[]; assignment?: ApiTeachingAssignment }) {
  if (role === 'TEACHER') return <ScrollView contentContainerStyle={styles.page}><Header title="Posts" subtitle="Create and manage school content" /><View style={styles.quickGrid}>{assignment ? <QuickAction icon={BookOpen} label="Homework" onPress={() => navigate({ name: 'compose', type: 'HOMEWORK' })} /> : null}{assignment?.canPublishResults ? <QuickAction icon={GraduationCap} label="Results" onPress={() => navigate({ name: 'compose', type: 'RESULT' })} /> : null}{assignment?.canPublishAnnouncements ? <QuickAction icon={Megaphone} label="Announcement" onPress={() => navigate({ name: 'compose', type: 'ANNOUNCEMENT' })} /> : null}</View><Text style={styles.sectionTitle}>Published</Text>{publishedPosts === undefined ? <><ActivityRow type="HOMEWORK" title="Fractions practice" meta="Today · 28 recipients" /><ActivityRow type="RESULT" title="Midyear results" meta="Yesterday · Private" /></> : publishedPosts.length ? publishedPosts.map((post) => <ActivityRow key={post.id} type={post.postType} title={post.title} meta={`${post.status === 'UPDATED' ? 'Updated' : new Date(post.publishedAt).toLocaleString()} · ${post.recipientCount} recipients`} onPress={() => navigate({ name: 'edit-post', postId: post.id })} />) : <EmptyState icon={BookOpen} title="Nothing published yet" body="Use a quick action above to publish your first update." />}<Text style={styles.sectionTitle}>Drafts</Text><ActivityRow type="ANNOUNCEMENT" title="Sports day reminder" meta="Draft · Saved on this device" /></ScrollView>;
  return <ScrollView contentContainerStyle={styles.page}><Header title="School updates" subtitle="Homework, results and announcements" />{(feed ?? scopedTimeline(childId)).map((post) => <TimelineCard key={post.id} post={post} onPress={() => navigate({ name: 'post-detail', postId: post.id })} />)}</ScrollView>;
}

function NotificationsScreen({ role, navigate }: { role: Role; navigate: (route: Route) => void }) {
  const items = role === 'PARENT' ? [
    { type: 'ATTENDANCE', title: 'Jenny was marked absent', meta: 'Today · Action required', unread: true, action: () => navigate({ name: 'absence', eventId: 'attendance-1' }) },
    { type: 'RESULT', title: 'Midyear results published', meta: 'Yesterday · Jenny Wilson', unread: true, action: () => navigate({ name: 'post-detail', postId: 'post-result' }) },
    { type: 'ANNOUNCEMENT', title: 'Holiday announcement updated', meta: '3 days ago · School', unread: false, action: () => navigate({ name: 'post-detail', postId: 'post-announcement' }) },
  ] : [
    { type: 'PUBLISH', title: 'Homework published', meta: 'Today · 28 recipients', unread: true, action: () => undefined },
    { type: 'VIEW', title: '31 guardians viewed your announcement', meta: 'Today · Grade 5A', unread: false, action: () => undefined },
  ];
  return <ScrollView contentContainerStyle={styles.page}><Header title="Notifications" subtitle={`${items.filter((item) => item.unread).length} unread`} />{items.length ? items.map((item, index) => <Pressable key={`${item.title}-${index}`} onPress={item.action} style={[styles.notificationRow, item.unread && styles.notificationUnread]}><View style={styles.listIcon}>{item.type === 'ATTENDANCE' ? <CircleAlert size={20} color={colors.warning} /> : <Bell size={20} color={colors.primary} />}</View><View style={styles.flex}><View style={styles.inline}><Text style={styles.cardTitle}>{item.title}</Text>{item.unread ? <View style={styles.unreadDot} /> : null}</View><Text style={styles.cardMeta}>{item.meta}</Text></View><ChevronRight size={19} color={colors.muted} /></Pressable>) : <EmptyState icon={Bell} title="No notifications, yet!" body="We’ll let you know when something new happens." />}</ScrollView>;
}

function AttendanceTab({ role, navigate, className = 'Grade 5A' }: { role: Role; navigate: (route: Route) => void; className?: string }) {
  if (role === 'TEACHER') return <ScrollView contentContainerStyle={styles.page}><Header title="Attendance" subtitle={`${className} · Today`} /><Pressable onPress={() => navigate({ name: 'teacher-attendance' })} style={styles.scopeCard}><View><Text style={styles.scopeTitle}>Take attendance</Text><Text style={styles.scopeMeta}>{className} · Not submitted</Text></View><ChevronRight size={20} color={colors.primary} /></Pressable><Pressable onPress={() => navigate({ name: 'follow-ups' })} style={styles.listRow}><View style={styles.listIcon}><Users size={20} color={colors.primary} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Absence follow-ups</Text><Text style={styles.cardMeta}>Assigned-class responses</Text></View><ChevronRight size={19} color={colors.muted} /></Pressable></ScrollView>;
  return <ScrollView contentContainerStyle={styles.page}><Header title="Attendance" subtitle="Jenny Wilson · This term" /><View style={styles.attendanceHero}><Text style={styles.attendancePercent}>75%</Text><Text style={styles.cardMeta}>Present</Text></View><View style={styles.statsRow}><Stat value="248" label="Present" tone="success" /><Stat value="82" label="Absent" tone="danger" /><Stat value="16" label="Leave" tone="warning" /></View><Text style={styles.sectionTitle}>Recent</Text><Pressable onPress={() => navigate({ name: 'absence', eventId: 'attendance-1' })} style={styles.listRow}><View style={styles.listIcon}><CircleAlert size={20} color={colors.warning} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Absent · Today</Text><Text style={styles.cardMeta}>Acknowledgement pending</Text></View><ChevronRight size={19} color={colors.muted} /></Pressable></ScrollView>;
}

function Stat({ value, label, tone }: { value: string; label: string; tone: 'success' | 'danger' | 'warning' }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Chip label={label} tone={tone} /></View>;
}

function ProfileScreen({ role, setRole, availableRoles, displayName, switchingRole, roleError, offline, setOffline, logout }: { role: Role; setRole: (role: Role) => void; availableRoles: Role[]; displayName: string; switchingRole: boolean; roleError: string; offline: boolean; setOffline: (value: boolean) => void; logout: () => void }) {
  const initials = displayName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return <ScrollView contentContainerStyle={styles.page}><Header title="Account" subtitle="School and preferences" /><View style={styles.profileCard}><View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{initials}</Text></View><View style={styles.flex}><Text style={styles.scopeTitle}>{displayName}</Text><Text style={styles.scopeMeta}>Thomas Jefferson High School</Text></View></View>{availableRoles.length > 1 ? <><Text style={styles.sectionTitle}>Active role</Text><View style={styles.roleSwitch}>{availableRoles.map((option) => <Pressable key={option} disabled={switchingRole} onPress={() => setRole(option)} style={[styles.roleChoice, role === option && styles.roleChoiceActive]}><Text style={[styles.roleText, role === option && styles.roleTextActive]}>{roleLabels[option]}</Text></Pressable>)}</View>{switchingRole ? <ActivityIndicator color={colors.primary} /> : null}{roleError ? <Text style={styles.errorText}>{roleError}</Text> : null}<Text style={styles.helper}>Role switching is available only because this account has more than one verified school membership.</Text></> : <View style={styles.notice}><ShieldCheck size={19} color={colors.info} /><Text style={styles.noticeText}>{roleLabels[role]} account · Access is fixed by the school invitation.</Text></View>}<Text style={styles.sectionTitle}>Preferences</Text><View style={styles.settingRow}><View><Text style={styles.cardTitle}>Demo offline state</Text><Text style={styles.cardMeta}>Preview cached-content messaging</Text></View><Switch value={offline} onValueChange={setOffline} trackColor={{ false: '#D9D6DE', true: colors.primarySoft }} thumbColor={offline ? colors.primary : '#fff'} /></View><View style={styles.settingRow}><View><Text style={styles.cardTitle}>Push notifications</Text><Text style={styles.cardMeta}>School updates and action-required alerts</Text></View><Switch value trackColor={{ true: colors.primarySoft }} thumbColor={colors.primary} /></View><PrimaryButton label="Log out securely" secondary onPress={logout} /></ScrollView>;
}

function PlatformOwnerDashboard({ session, logout }: { session: MobileSession; logout: () => void }) {
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const [schoolCode, setSchoolCode] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Riyadh');
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [result, setResult] = useState<{ schoolName: string; adminName: string; adminPhone: string; invitationCode: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const refresh = () => { void mobileApi.schools(session).then(setSchools).catch((failure) => setError(failure instanceof Error ? failure.message : 'SCHOOLS_LOAD_FAILED')); };
  useEffect(refresh, [session]);
  const createSchool = async () => {
    setError(''); setResult(null); setSaving(true);
    try {
      const created = await mobileApi.createSchool(session, { schoolCode, displayName: schoolName, timezone, adminDisplayName: adminName, adminPhoneE164: adminPhone.replace(/\s/g, '') });
      setResult({ schoolName: created.school.displayName, adminName, adminPhone, invitationCode: created.administrator.invitationCode, expiresAt: created.administrator.expiresAt });
      setSchoolCode(''); setSchoolName(''); setAdminName(''); setAdminPhone(''); refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'SCHOOL_CREATION_FAILED'); }
    finally { setSaving(false); }
  };
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Header title="Platform administration" subtitle="Schools and first administrators" /><View style={styles.notice}><ShieldCheck size={19} color={colors.info} /><Text style={styles.noticeText}>Platform Owner can provision schools, but cannot access school posts, students, results or attendance.</Text></View><Text style={styles.sectionTitle}>Add a school</Text><Field label="School code" value={schoolCode} onChangeText={setSchoolCode} placeholder="e.g. NORTH001" required /><Field label="School name" value={schoolName} onChangeText={setSchoolName} placeholder="Official school name" required /><Field label="Timezone" value={timezone} onChangeText={setTimezone} placeholder="e.g. Asia/Riyadh" required /><Text style={styles.sectionTitle}>First school administrator</Text><Field label="Administrator name" value={adminName} onChangeText={setAdminName} placeholder="Full name" required /><Field label="Administrator mobile" value={adminPhone} onChangeText={setAdminPhone} placeholder="+966..." required />{error ? <Text style={styles.errorText}>{error}</Text> : null}<PrimaryButton label="Create school and administrator" onPress={() => { void createSchool(); }} loading={saving} disabled={!schoolCode.trim() || !schoolName.trim() || !adminName.trim() || adminPhone.length < 8} />{result ? <View style={styles.successCard}><Text style={styles.cardTitleLarge}>School created</Text><Text style={styles.cardBody}>{result.schoolName}</Text><Text style={styles.cardTitle}>Administrator login</Text><Text style={styles.cardBody}>{result.adminName} · {result.adminPhone}</Text><Text style={styles.invitationCode}>{result.invitationCode}</Text><Text style={styles.cardMeta}>Invitation expires {new Date(result.expiresAt).toLocaleDateString()}. Development OTP: 123456</Text></View> : null}<Text style={styles.sectionTitle}>Schools</Text>{schools.map((school) => <View key={school.id} style={styles.listRow}><View style={styles.listIcon}><GraduationCap size={20} color={colors.primary} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{school.displayName}</Text><Text style={styles.cardMeta}>{school.schoolCode} · {school.timezone} · {school.status}</Text></View></View>)}<PrimaryButton label="Log out securely" secondary onPress={logout} /></ScrollView></SafeAreaView>;
}

function SchoolAdminDashboard({ session, logout }: { session: MobileSession; logout: () => void }) {
  const [schoolName, setSchoolName] = useState('School administration');
  const [classes, setClasses] = useState<ApiSchoolClass[]>([]);
  const [classCode, setClassCode] = useState('');
  const [className, setClassName] = useState('');
  const [academicYear, setAcademicYear] = useState('2026-2027');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhone, setTeacherPhone] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [canPublishResults, setCanPublishResults] = useState(false);
  const [canPublishAnnouncements, setCanPublishAnnouncements] = useState(true);
  const [canRecordAttendance, setCanRecordAttendance] = useState(true);
  const [invitation, setInvitation] = useState<{ displayName: string; phone: string; code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savingClass, setSavingClass] = useState(false);
  const [savingTeacher, setSavingTeacher] = useState(false);
  const refreshClasses = () => { void mobileApi.adminClasses(session).then((items) => { setClasses(items); setSelectedClassId((current) => current || items[0]?.id || ''); }).catch((failure) => setError(failure instanceof Error ? failure.message : 'CLASSES_LOAD_FAILED')); };
  useEffect(() => { refreshClasses(); void mobileApi.context(session).then((context) => setSchoolName(context.school?.displayName ?? 'School administration')); }, [session]);
  const createClass = async () => {
    setError(''); setMessage(''); setSavingClass(true);
    try { const created = await mobileApi.createClass(session, { classCode, displayName: className, academicYear }); setSelectedClassId(created.id); setClassCode(''); setClassName(''); setMessage(`${created.displayName} is ready for teacher assignments.`); refreshClasses(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'CLASS_CREATION_FAILED'); }
    finally { setSavingClass(false); }
  };
  const createTeacher = async () => {
    setError(''); setMessage(''); setInvitation(null); setSavingTeacher(true);
    try {
      const created = await mobileApi.createTeacher(session, { displayName: teacherName, phoneE164: teacherPhone.replace(/\s/g, ''), classId: selectedClassId, subjectCode, subjectName, canPublishResults, canPublishAnnouncements, canRecordAttendance });
      setInvitation({ displayName: teacherName, phone: teacherPhone, code: created.teacher.invitationCode, expiresAt: created.teacher.expiresAt });
      setTeacherName(''); setTeacherPhone(''); setSubjectCode(''); setSubjectName('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'TEACHER_CREATION_FAILED'); }
    finally { setSavingTeacher(false); }
  };
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Header title={schoolName} subtitle="School administrator" /><View style={styles.notice}><ShieldCheck size={19} color={colors.info} /><Text style={styles.noticeText}>Every class and teacher created here is locked to this school. Permissions default to the minimum selected below.</Text></View><Text style={styles.sectionTitle}>Add a class</Text><Field label="Class code" value={classCode} onChangeText={setClassCode} placeholder="e.g. G5A" required /><Field label="Class name" value={className} onChangeText={setClassName} placeholder="e.g. Grade 5A" required /><Field label="Academic year" value={academicYear} onChangeText={setAcademicYear} placeholder="YYYY-YYYY" required /><PrimaryButton label="Create class" onPress={() => { void createClass(); }} loading={savingClass} disabled={!classCode.trim() || !className.trim()} /><Text style={styles.sectionTitle}>Add a teacher</Text>{classes.length ? <><Text style={styles.label}>Assigned class *</Text>{classes.map((item) => <Pressable key={item.id} onPress={() => setSelectedClassId(item.id)} style={[styles.checkRow, selectedClassId === item.id && styles.checkRowActive]}><View style={[styles.checkbox, selectedClassId === item.id && styles.checkboxActive]}>{selectedClassId === item.id ? <Check size={15} color="#fff" /> : null}</View><View style={styles.flex}><Text style={styles.cardTitle}>{item.displayName}</Text><Text style={styles.cardMeta}>{item.classCode} · {item.academicYear}</Text></View></Pressable>)}<Field label="Teacher name" value={teacherName} onChangeText={setTeacherName} placeholder="Full name" required /><Field label="Teacher mobile" value={teacherPhone} onChangeText={setTeacherPhone} placeholder="+966..." required /><Field label="Subject code" value={subjectCode} onChangeText={setSubjectCode} placeholder="e.g. MATH" required /><Field label="Subject name" value={subjectName} onChangeText={setSubjectName} placeholder="e.g. Mathematics" required /><PermissionToggle label="Publish announcements" value={canPublishAnnouncements} onChange={setCanPublishAnnouncements} /><PermissionToggle label="Record attendance" value={canRecordAttendance} onChange={setCanRecordAttendance} /><PermissionToggle label="Publish private results" value={canPublishResults} onChange={setCanPublishResults} /><PrimaryButton label="Create teacher account" onPress={() => { void createTeacher(); }} loading={savingTeacher} disabled={!selectedClassId || !teacherName.trim() || teacherPhone.length < 8 || !subjectCode.trim() || !subjectName.trim()} /></> : <EmptyState icon={Users} title="Create a class first" body="A teacher account needs at least one active class and subject assignment." />}{message ? <Text style={styles.successText}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}{invitation ? <View style={styles.successCard}><Text style={styles.cardTitleLarge}>Teacher account created</Text><Text style={styles.cardBody}>{invitation.displayName} · {invitation.phone}</Text><Text style={styles.invitationCode}>{invitation.code}</Text><Text style={styles.cardMeta}>Invitation expires {new Date(invitation.expiresAt).toLocaleDateString()}. Development OTP: 123456</Text></View> : null}<PrimaryButton label="Log out securely" secondary onPress={logout} /></ScrollView></SafeAreaView>;
}

function PermissionToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.settingRow}><Text style={styles.cardTitle}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ false: '#D9D6DE', true: colors.primarySoft }} thumbColor={value ? colors.primary : '#fff'} /></View>;
}

function ComposeScreen({ type, onBack, onDone, session, onPublished, editing, assignment }: { type: PostType; onBack: () => void; onDone: () => void; session: MobileSession | null; onPublished: () => void; editing?: ApiTeacherPost; assignment?: ApiTeachingAssignment }) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [dueDate, setDueDate] = useState(() => editing?.dueDate ? String(editing.dueDate).slice(0, 10) : (() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); return tomorrow.toISOString().slice(0, 10); })());
  const [exam, setExam] = useState(editing?.examName ?? 'Midyear examination');
  const [urgent, setUrgent] = useState(editing?.urgent ?? false);
  const [privacy, setPrivacy] = useState(false);
  const [upload, setUpload] = useState<'EMPTY' | 'UPLOADING' | 'FAILED' | 'READY'>('EMPTY');
  const [published, setPublished] = useState(false);
  const [error, setError] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const key = editing ? `draft:edit:${editing.id}:${editing.revisionNumber}` : `draft:${type}`;
  useEffect(() => { void AsyncStorage.getItem(key).then((value) => { if (!value) return; const draft = JSON.parse(value) as { title?: string; body?: string }; setTitle(draft.title ?? ''); setBody(draft.body ?? ''); }); }, [key]);
  useEffect(() => { const timer = setTimeout(() => { void AsyncStorage.setItem(key, JSON.stringify({ title, body })); }, 250); return () => clearTimeout(timer); }, [key, title, body]);
  const attach = () => { setUpload('UPLOADING'); setTimeout(() => setUpload('READY'), 650); };
  const publish = async () => {
    const invalid = !title.trim() || !body.trim() || (type === 'HOMEWORK' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) || (type === 'RESULT' && !editing && (upload !== 'READY' || !privacy));
    setError(invalid);
    setPublishError('');
    if (invalid) return;
    if (!session) {
      setPublished(true);
      await AsyncStorage.removeItem(key);
      return;
    }
    if (type === 'RESULT' && !editing) {
      setPublishError('Private result publishing needs the real per-student file upload. The current attachment control is only a preview, so no false success was recorded.');
      return;
    }
    setPublishing(true);
    try {
      if (editing) {
        await mobileApi.revisePost(session, editing.id, {
          expectedRevisionNumber: editing.revisionNumber,
          title: title.trim(),
          body: body.trim(),
          subjectCode: editing.subjectCode,
          examName: type === 'RESULT' ? exam : undefined,
          dueDate: type === 'HOMEWORK' ? dueDate : undefined,
          urgent: type === 'ANNOUNCEMENT' ? urgent : false,
          changeKind: 'MATERIAL',
        });
      } else {
        const assignments = await mobileApi.teachingScope(session);
        const assignment = assignments.find((item) => type === 'RESULT' ? item.canPublishResults : type === 'ANNOUNCEMENT' ? item.canPublishAnnouncements : true);
        if (!assignment) throw new Error('NO_ACTIVE_TEACHING_ASSIGNMENT');
        await mobileApi.publish(session, {
          classId: assignment.classId,
          postType: type,
          title: title.trim(),
          body: body.trim(),
          subjectCode: assignment.subjectCode,
          dueDate: type === 'HOMEWORK' ? dueDate : undefined,
          audienceType: 'CLASS',
          urgent: type === 'ANNOUNCEMENT' ? urgent : false,
          idempotencyKey: createIdempotencyKey(),
        });
      }
      await AsyncStorage.removeItem(key);
      setPublished(true);
      onPublished();
    } catch (publishFailure) {
      setPublishError(publishFailure instanceof Error ? publishFailure.message : 'PUBLISH_FAILED');
    } finally {
      setPublishing(false);
    }
  };
  if (published) return <SafeAreaView style={styles.safe}><View style={styles.successPage}><View style={styles.successIcon}><Check size={42} color="#fff" /></View><Text style={styles.successTitle}>{postLabels[type]} {editing ? 'updated' : 'published'}</Text><Text style={styles.successBody}>{editing ? 'A new revision was saved. Parents will see the Updated label while the previous version remains in the audit history.' : 'The eligible audience was resolved and the notification event was queued.'}</Text><PrimaryButton label="Back to posts" onPress={onDone} /></View></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.page}><Header title={`${editing ? 'Edit' : 'New'} ${postLabels[type].toLowerCase()}`} subtitle={assignment?.className ?? 'Assigned class'} onBack={onBack} /><View style={styles.scopeCard}><View><Text style={styles.eyebrow}>AUDIENCE</Text><Text style={styles.cardTitle}>{assignment?.className ?? 'Assigned class'} · {assignment?.subjectName ?? (type === 'ANNOUNCEMENT' ? 'Guardians' : 'Subject')}</Text></View><ChevronDown size={19} color={colors.primary} /></View>{editing ? <View style={styles.notice}><ShieldCheck size={19} color={colors.info} /><Text style={styles.noticeText}>Saving creates revision {editing.revisionNumber + 1}. Audience and existing attachments stay unchanged.</Text></View> : null}{type === 'RESULT' ? <Field label="Exam" value={exam} onChangeText={setExam} placeholder="Exam name" required /> : null}<Field label="Title" value={title} onChangeText={setTitle} placeholder={type === 'HOMEWORK' ? 'e.g. Fractions practice' : `${postLabels[type]} title`} required error={error && !title.trim() ? 'Enter a title.' : undefined} />{type === 'HOMEWORK' ? <Field label="Due date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" required error={error && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? 'Use YYYY-MM-DD.' : undefined} /> : null}<Field label={type === 'HOMEWORK' ? 'Instructions' : 'Message'} value={body} onChangeText={setBody} placeholder="Write clear details for parents" multiline required error={error && !body.trim() ? 'Enter details.' : undefined} />{!editing ? <><Text style={styles.label}>{type === 'RESULT' ? 'Private result file *' : 'Attachment'}</Text><UploadTile state={upload} onAttach={attach} onFail={() => setUpload('FAILED')} /></> : null}{type === 'RESULT' && !editing ? <Pressable onPress={() => setPrivacy((value) => !value)} style={[styles.checkRow, privacy && styles.checkRowActive]}><View style={[styles.checkbox, privacy && styles.checkboxActive]}>{privacy ? <Check size={15} color="#fff" /> : null}</View><View style={styles.flex}><Text style={styles.cardTitle}>Privacy confirmed</Text><Text style={styles.cardMeta}>Each file is mapped to the named student and is not class-public.</Text></View></Pressable> : null}{type === 'ANNOUNCEMENT' ? <View style={styles.settingRow}><View><Text style={styles.cardTitle}>Mark urgent</Text><Text style={styles.cardMeta}>Requires the urgent-announcement grant</Text></View><Switch value={urgent} onValueChange={setUrgent} trackColor={{ true: colors.primarySoft }} thumbColor={urgent ? colors.primary : '#fff'} /></View> : null}{error && type === 'RESULT' && !editing && (upload !== 'READY' || !privacy) ? <Text style={styles.errorText}>A ready private file and privacy confirmation are required.</Text> : null}{publishError ? <Text style={styles.errorText}>{publishError}</Text> : null}<Text style={styles.draftText}>Draft saves automatically on this device.</Text><PrimaryButton label={editing ? 'Save correction' : 'Publish now'} onPress={() => { void publish(); }} loading={publishing} /></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function UploadTile({ state, onAttach, onFail }: { state: 'EMPTY' | 'UPLOADING' | 'FAILED' | 'READY'; onAttach: () => void; onFail: () => void }) {
  if (state === 'EMPTY') return <Pressable onPress={onAttach} style={styles.uploadTile}><View style={styles.uploadIcon}><Paperclip size={21} color={colors.primary} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Add PDF or image</Text><Text style={styles.cardMeta}>Private · up to configured file limit</Text></View><ChevronRight size={18} color={colors.muted} /></Pressable>;
  if (state === 'UPLOADING') return <Pressable onLongPress={onFail} style={styles.uploadTile}><ActivityIndicator color={colors.primary} /><View style={styles.flex}><Text style={styles.cardTitle}>Uploading… 64%</Text><View style={styles.progress}><View style={styles.progressFill} /></View><Text style={styles.cardMeta}>Draft remains safe if connection drops</Text></View></Pressable>;
  if (state === 'FAILED') return <Pressable onPress={onAttach} style={[styles.uploadTile, styles.uploadFailed]}><RefreshCw size={21} color={colors.danger} /><View style={styles.flex}><Text style={styles.cardTitle}>Upload failed</Text><Text style={styles.cardMeta}>Tap to retry. Publishing is blocked.</Text></View></Pressable>;
  return <View style={styles.uploadTile}><FileText size={22} color={colors.primary} /><View style={styles.flex}><Text style={styles.cardTitle}>Document.pdf</Text><Text style={styles.cardMeta}>240 KB · Scanned and ready</Text></View><Chip label="Ready" tone="success" /></View>;
}

function TeacherAttendance({ onBack, className = 'Grade 5A' }: { onBack: () => void; className?: string }) {
  const roster = ['Aarav Sharma', 'Diya Patel', 'Kabir Singh', 'Meera Nair', 'Vihaan Rao'];
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(Object.fromEntries(roster.map((name) => [name, 'PRESENT'])));
  const [submitted, setSubmitted] = useState(false);
  if (submitted) return <SafeAreaView style={styles.safe}><View style={styles.successPage}><View style={styles.successIcon}><Check size={42} color="#fff" /></View><Text style={styles.successTitle}>Attendance submitted</Text><Text style={styles.successBody}>The class batch was committed atomically. Absence notifications are queued once.</Text><PrimaryButton label="Done" onPress={onBack} /></View></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Header title="Take attendance" subtitle={`${className} · Today`} onBack={onBack} /><View style={styles.notice}><ShieldCheck size={19} color={colors.info} /><Text style={styles.noticeText}>All students submit as one versioned batch. Conflicts never partially apply.</Text></View>{roster.map((student) => <View key={student} style={styles.rosterRow}><View style={styles.avatarSmall}><Text style={styles.avatarText}>{student.split(' ').map((part) => part[0]).join('')}</Text></View><Text style={[styles.cardTitle, styles.flex]}>{student}</Text><View style={styles.statusControl}>{(['PRESENT', 'ABSENT'] as const).map((status) => <Pressable key={status} accessibilityLabel={`${student} ${status}`} onPress={() => setStatuses((value) => ({ ...value, [student]: status }))} style={[styles.statusOption, statuses[student] === status && (status === 'PRESENT' ? styles.statusPresent : styles.statusAbsent)]}><Text style={[styles.statusOptionText, statuses[student] === status && styles.statusOptionTextActive]}>{status === 'PRESENT' ? 'P' : 'A'}</Text></Pressable>)}</View></View>)}<PrimaryButton label="Submit attendance" onPress={() => setSubmitted(true)} /></ScrollView></SafeAreaView>;
}

function FollowUps({ onBack, className = 'Grade 5A' }: { onBack: () => void; className?: string }) {
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Header title="Absence follow-ups" subtitle={`${className} · Today`} onBack={onBack} /><View style={styles.filterRow}><Chip label="All 3" /><Chip label="Pending 2" tone="warning" /><Chip label="Acknowledged 1" tone="success" /></View><FollowUp name="Kabir Singh" guardian="Raj Singh" status="Pending" /><FollowUp name="Meera Nair" guardian="Anita Nair" status="Pending" /><FollowUp name="Vihaan Rao" guardian="Suresh Rao" status="Acknowledged" /></ScrollView></SafeAreaView>;
}

function FollowUp({ name, guardian, status }: { name: string; guardian: string; status: 'Pending' | 'Acknowledged' }) {
  return <View style={styles.listRow}><View style={styles.avatarSmall}><Text style={styles.avatarText}>{name.split(' ').map((part) => part[0]).join('')}</Text></View><View style={styles.flex}><Text style={styles.cardTitle}>{name}</Text><Text style={styles.cardMeta}>{guardian} · Individual response</Text></View><Chip label={status} tone={status === 'Pending' ? 'warning' : 'success'} /></View>;
}

function PostDetail({ postId, role, childId, navigate, onBack, content = posts }: { postId: string; role: Role; childId: string; navigate: (route: Route) => void; onBack: () => void; content?: TimelinePost[] }) {
  const post = content.find((item) => item.id === postId);
  if (!post || (role === 'PARENT' && post.childId !== childId)) return <SafeAreaView style={styles.safe}><View style={styles.page}><Header title="Content unavailable" onBack={onBack} /><EmptyState icon={ShieldCheck} title="You can’t open this item" body="The resource is not available in the active child and school context." /></View></SafeAreaView>;
  const Icon = postIcons[post.type];
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Header title={postLabels[post.type]} subtitle={post.subject ?? 'School update'} onBack={onBack} /><View style={styles.detailIcon}><Icon size={28} color={colors.primary} /></View><View style={styles.inline}>{post.updated ? <Chip label="Updated" tone="info" /> : null}<Text style={styles.cardMeta}>{post.timestamp}</Text></View><Text style={styles.detailTitle}>{post.title}</Text><Text style={styles.detailMeta}>{post.author}{post.dueDate ? ` · Due ${post.dueDate}` : ''}</Text><Text style={styles.detailBody}>{post.body}</Text>{post.attachment ? <Pressable onPress={() => post.attachment?.state === 'READY' && navigate({ name: 'file-preview', fileName: post.attachment.name })} style={styles.uploadTile}><FileText size={24} color={colors.primary} /><View style={styles.flex}><Text style={styles.cardTitle}>{post.attachment.name}</Text><Text style={styles.cardMeta}>{post.attachment.size} · Private attachment</Text></View>{post.attachment.state === 'READY' ? <ChevronRight size={19} color={colors.muted} /> : <X size={19} color={colors.danger} />}</Pressable> : null}<View style={styles.notice}><Check size={18} color={colors.success} /><Text style={styles.noticeText}>Viewed just now. Viewing does not acknowledge attendance.</Text></View></ScrollView></SafeAreaView>;
}

function AbsenceScreen({ onBack }: { onBack: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [leave, setLeave] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Header title="Absence details" subtitle="Jenny Wilson · Today" onBack={onBack} /><View style={styles.absenceHero}><CircleAlert size={29} color={colors.warning} /><View style={styles.flex}><Text style={styles.detailTitle}>Marked absent</Text><Text style={styles.cardMeta}>Grade 5A · Recorded by Ms. Priya at 9:08 AM</Text></View><Chip label={submitted ? (leave ? 'Leave submitted' : 'Acknowledged') : 'Pending'} tone={submitted ? 'success' : 'warning'} /></View><View style={styles.notice}><ShieldCheck size={19} color={colors.info} /><Text style={styles.noticeText}>Acknowledgement confirms you saw this alert. It does not justify or change official attendance.</Text></View>{submitted ? <View style={styles.responseCard}><View style={styles.successMini}><Check size={18} color="#fff" /></View><View style={styles.flex}><Text style={styles.cardTitle}>{leave ? 'Leave note submitted' : 'Absence acknowledged'}</Text><Text style={styles.cardMeta}>Recorded with guardian identity and timestamp</Text>{reason ? <Text style={styles.cardBody}>Reason: {reason}</Text> : null}</View></View> : <><Pressable onPress={() => setAcknowledged((value) => !value)} style={[styles.checkRow, acknowledged && styles.checkRowActive]}><View style={[styles.checkbox, acknowledged && styles.checkboxActive]}>{acknowledged ? <Check size={15} color="#fff" /> : null}</View><View style={styles.flex}><Text style={styles.cardTitle}>I acknowledge this absence alert</Text><Text style={styles.cardMeta}>Required explicit action</Text></View></Pressable><Field label="Optional reason" value={reason} onChangeText={setReason} placeholder="Tell the school why Jenny was absent" multiline /><Pressable onPress={() => setLeave((value) => !value)} style={[styles.checkRow, leave && styles.checkRowActive]}><View style={[styles.checkbox, leave && styles.checkboxActive]}>{leave ? <Check size={15} color="#fff" /> : null}</View><View style={styles.flex}><Text style={styles.cardTitle}>Submit as a leave note</Text><Text style={styles.cardMeta}>School review is separate from official attendance.</Text></View></Pressable><PrimaryButton label={leave ? 'Acknowledge and submit leave note' : 'Acknowledge absence'} disabled={!acknowledged} onPress={() => setSubmitted(true)} /></>}</ScrollView></SafeAreaView>;
}

function FilePreview({ fileName, onBack }: { fileName: string; onBack: () => void }) {
  return <SafeAreaView style={styles.filePage}><Header title="Private file" subtitle="Authorized preview" onBack={onBack} /><View style={styles.fileCanvas}><FileText size={68} color={colors.primary} /><Text style={styles.fileTitle}>{fileName}</Text><Text style={styles.fileMeta}>Access checked for the active school, role and child. The production API issues a short-lived URL only after this check.</Text></View><View style={styles.fileActions}><PrimaryButton label="Close preview" onPress={onBack} /></View></SafeAreaView>;
}

function BottomNav({ role, active, onChange }: { role: Role; active: TabKey; onChange: (tab: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: 'home', label: 'Home', icon: Home }, { key: 'posts', label: 'Posts', icon: BookOpen }, { key: 'attendance', label: 'Attendance', icon: CalendarCheck }, { key: 'notifications', label: 'Alerts', icon: Bell }, { key: 'profile', label: role === 'TEACHER' ? 'Profile' : 'Account', icon: UserRound },
  ];
  return <View style={styles.bottomNav}>{tabs.map(({ key, label, icon: Icon }) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active === key }} onPress={() => onChange(key)} style={styles.navItem}><Icon size={21} color={active === key ? colors.primary : colors.muted} strokeWidth={active === key ? 2.6 : 2} /><Text style={[styles.navLabel, active === key && styles.navLabelActive]}>{label}</Text></Pressable>)}</View>;
}

function MainApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRoleState] = useState<Role>('PARENT');
  const [tab, setTab] = useState<TabKey>('home');
  const [childId, setChildId] = useState(children[0]!.id);
  const [route, setRoute] = useState<Route>(null);
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState<MobileSession | null>(null);
  const [liveChildren, setLiveChildren] = useState<Child[]>([]);
  const [livePosts, setLivePosts] = useState<TimelinePost[]>([]);
  const [teacherPosts, setTeacherPosts] = useState<ApiTeacherPost[]>([]);
  const [teachingScope, setTeachingScope] = useState<ApiTeachingAssignment[]>([]);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [restoring, setRestoring] = useState(!demoMode);

  useEffect(() => {
    if (demoMode) return;
    void loadSession().then(async (stored) => {
      if (!stored) return;
      try {
        const context = await mobileApi.context(stored);
        const refreshed = { ...stored, memberships: context.memberships };
        await saveSession(refreshed);
        setSession(refreshed);
        setRoleState(context.principal.role);
        setSignedIn(true);
      } catch { await clearSession(); }
    }).finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    if (!session || role !== 'PARENT') return;
    void mobileApi.children(session).then((items) => {
      const mapped = items.map((item) => ({
        id: item.id,
        name: item.displayName,
        school: item.schoolName,
        className: item.className,
        avatar: item.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      }));
      setLiveChildren(mapped);
      if (mapped[0] && !mapped.some((item) => item.id === childId)) setChildId(mapped[0].id);
    });
  }, [session, role, childId]);

  useEffect(() => {
    if (!session || role !== 'PARENT' || !childId || !liveChildren.some((item) => item.id === childId)) return;
    let active = true;
    const refresh = () => { void mobileApi.timeline(session, childId).then((items) => {
      if (!active) return;
      setLivePosts(items.map((item) => ({
        id: item.id,
        childId,
        type: item.postType,
        title: item.title,
        body: item.body,
        subject: item.subjectCode ?? item.examName,
        dueDate: item.dueDate ? new Date(item.dueDate).toLocaleDateString() : undefined,
        author: 'SchoolConnect',
        timestamp: new Date(item.publishedAt).toLocaleString(),
        unread: false,
        updated: item.status === 'UPDATED',
        attachment: item.attachments[0] ? { name: 'Private attachment', size: 'Authorized file', state: 'READY' } : undefined,
      })));
    }).catch(() => undefined); };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [session, role, childId, liveChildren]);

  useEffect(() => {
    if (!session || role !== 'TEACHER') return;
    let active = true;
    const refresh = () => { void mobileApi.teacherPosts(session).then((items) => { if (active) setTeacherPosts(items); }).catch(() => undefined); };
    refresh();
    void mobileApi.teachingScope(session).then((items) => { if (active) setTeachingScope(items); }).catch(() => undefined);
    const timer = setInterval(refresh, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [session, role]);

  const refreshTeacherPosts = () => {
    if (!session) return;
    void mobileApi.teacherPosts(session).then(setTeacherPosts).catch(() => undefined);
  };

  const setRole = async (next: Role) => {
    if (next === role || switchingRole) return;
    setRoleError('');
    if (session) {
      const membership = session.memberships.find((item) => item.role === next);
      if (!membership) {
        setRoleError('This account does not have that role.');
        return;
      }
      setSwitchingRole(true);
      try {
        const switched = await mobileApi.switchRole(session, membership.id);
        const nextSession = { ...session, accessToken: switched.accessToken };
        await saveSession(nextSession);
        setSession(nextSession);
      } catch (switchFailure) {
        setRoleError(switchFailure instanceof Error ? switchFailure.message : 'ROLE_SWITCH_FAILED');
        setSwitchingRole(false);
        return;
      }
      setSwitchingRole(false);
    }
    setRoleState(next);
    setTab('home');
    setRoute(null);
    setChildId(session ? liveChildren[0]?.id ?? '' : children[0]!.id);
  };
  const logout = () => { void clearSession(); setSession(null); setLiveChildren([]); setLivePosts([]); setTeacherPosts([]); setTeachingScope([]); setTab('home'); setRoute(null); setSignedIn(false); };
  if (restoring) return <View style={styles.loader}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!signedIn) return <LoginScreen onSignedIn={(resolvedRole, authenticatedSession) => { setSession(authenticatedSession ?? null); setRoleState(resolvedRole); setSignedIn(true); }} />;
  if (session && role === 'PLATFORM_OWNER') return <PlatformOwnerDashboard session={session} logout={logout} />;
  if (session && role === 'SCHOOL_ADMIN') return <SchoolAdminDashboard session={session} logout={logout} />;
  if (route?.name === 'compose') return <ComposeScreen type={route.type} assignment={teachingScope[0]} session={session} onPublished={refreshTeacherPosts} onBack={() => setRoute(null)} onDone={() => { setRoute(null); setTab('posts'); }} />;
  if (route?.name === 'edit-post') {
    const editing = teacherPosts.find((post) => post.id === route.postId);
    if (!editing) return <SafeAreaView style={styles.safe}><View style={styles.page}><Header title="Content unavailable" onBack={() => setRoute(null)} /><EmptyState icon={ShieldCheck} title="This post cannot be edited" body="Refresh the teacher post list and try again." /></View></SafeAreaView>;
    return <ComposeScreen type={editing.postType} editing={editing} assignment={teachingScope.find((item) => item.subjectCode === editing.subjectCode) ?? teachingScope[0]} session={session} onPublished={refreshTeacherPosts} onBack={() => setRoute(null)} onDone={() => { setRoute(null); setTab('posts'); }} />;
  }
  if (route?.name === 'teacher-attendance') return <TeacherAttendance className={teachingScope[0]?.className} onBack={() => setRoute(null)} />;
  if (route?.name === 'follow-ups') return <FollowUps className={teachingScope[0]?.className} onBack={() => setRoute(null)} />;
  if (route?.name === 'post-detail') return <PostDetail postId={route.postId} role={role} childId={childId} navigate={setRoute} onBack={() => setRoute(null)} content={session && role === 'PARENT' ? livePosts : posts} />;
  if (route?.name === 'absence') return <AbsenceScreen onBack={() => setRoute(null)} />;
  if (route?.name === 'file-preview') return <FilePreview fileName={route.fileName} onBack={() => setRoute(null)} />;
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><View style={styles.appBody}>{tab === 'home' ? role === 'TEACHER' ? <TeacherHome navigate={setRoute} publishedPosts={session ? teacherPosts : undefined} teacherName={session?.user.displayName} assignment={teachingScope[0]} /> : <ParentHome childId={childId} setChildId={setChildId} navigate={setRoute} offline={offline} availableChildren={session ? liveChildren : children} feed={session ? livePosts : undefined} /> : null}{tab === 'posts' ? <PostsScreen role={role} childId={childId} navigate={setRoute} feed={session && role === 'PARENT' ? livePosts : undefined} publishedPosts={session && role === 'TEACHER' ? teacherPosts : undefined} assignment={teachingScope[0]} /> : null}{tab === 'attendance' ? <AttendanceTab role={role} navigate={setRoute} className={teachingScope[0]?.className} /> : null}{tab === 'notifications' ? <NotificationsScreen role={role} navigate={setRoute} /> : null}{tab === 'profile' ? <ProfileScreen role={role} setRole={(next) => { void setRole(next); }} availableRoles={session ? Array.from(new Set(session.memberships.map((membership) => membership.role))) : ['TEACHER', 'PARENT']} displayName={session?.user.displayName ?? (role === 'TEACHER' ? 'Ms. Priya' : 'Ahmed Ali')} switchingRole={switchingRole} roleError={roleError} offline={offline} setOffline={setOffline} logout={logout} /> : null}</View><BottomNav role={role} active={tab} onChange={setTab} /></SafeAreaView>;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular: PoppinsRegular,
    Poppins_500Medium: PoppinsMedium,
    Poppins_600SemiBold: PoppinsSemiBold,
    Poppins_700Bold: PoppinsBold,
  });
  if (!fontsLoaded) return <View style={styles.loader}><ActivityIndicator color={colors.primary} size="large" /></View>;
  return <SafeAreaProvider><StatusBar style="dark" /><MainApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface }, flex: { flex: 1 }, appBody: { flex: 1, backgroundColor: colors.surface }, loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  page: { paddingHorizontal: 20, paddingBottom: 28, gap: 14, backgroundColor: colors.surface, minHeight: '100%' }, header: { paddingTop: 12, paddingBottom: 8 }, headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 }, headerText: { flex: 1, marginHorizontal: 12 }, headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 22, color: colors.ink }, headerSubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: colors.muted, marginTop: 1 }, brandMark: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }, iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, iconPlaceholder: { width: 44 },
  login: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: colors.background }, loginHero: { alignItems: 'center', marginBottom: 28 }, loginLogo: { width: 82, height: 82, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginBottom: 18 }, loginTitle: { fontFamily: 'Poppins_700Bold', fontSize: 26, textAlign: 'center', color: colors.ink }, loginBody: { fontFamily: 'Poppins_400Regular', fontSize: 14, lineHeight: 22, textAlign: 'center', color: colors.muted, marginTop: 8, maxWidth: 320 }, loginCard: { backgroundColor: colors.surface, borderRadius: 22, padding: 20, gap: 14, borderWidth: 1, borderColor: colors.border },
  button: { minHeight: 54, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, paddingHorizontal: 18 }, buttonPressed: { backgroundColor: colors.primaryPressed, transform: [{ scale: 0.99 }] }, buttonDisabled: { opacity: 0.45 }, buttonText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#fff' }, buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary }, buttonSecondaryText: { color: colors.primary },
  fieldWrap: { gap: 7 }, label: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.ink }, required: { color: colors.danger }, input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, paddingHorizontal: 14, fontFamily: 'Poppins_400Regular', fontSize: 15, color: colors.ink, backgroundColor: '#FBFBFD' }, textarea: { minHeight: 126, paddingTop: 14, textAlignVertical: 'top' }, inputError: { borderColor: colors.danger }, errorText: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: colors.danger }, helper: { fontFamily: 'Poppins_400Regular', fontSize: 13, lineHeight: 20, color: colors.muted }, link: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.primary, textAlign: 'center' }, linkInline: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: colors.primary },
  securityNote: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 4 }, securityText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 11, lineHeight: 17, color: colors.muted }, offline: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.warningSoft }, offlineText: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: colors.warning },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: colors.ink, marginTop: 4 }, sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { fontFamily: 'Poppins_600SemiBold', fontSize: 10, letterSpacing: 1.2, color: colors.primary }, scopeCard: { minHeight: 83, borderRadius: radius.card, padding: 16, backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scopeTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: colors.ink }, scopeMeta: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: colors.muted, marginTop: 2 }, quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, quickAction: { width: '47.9%', minHeight: 98, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, justifyContent: 'space-between', backgroundColor: colors.surface }, quickIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, quickLabel: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.ink }, cardPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  listRow: { minHeight: 72, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface }, listIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, cardTitle: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.ink }, cardTitleLarge: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: colors.ink }, cardBody: { fontFamily: 'Poppins_400Regular', fontSize: 12, lineHeight: 19, color: colors.muted }, cardMeta: { fontFamily: 'Poppins_400Regular', fontSize: 11, lineHeight: 17, color: colors.muted }, cardEyebrow: { fontFamily: 'Poppins_600SemiBold', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.primary }, cardTime: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: colors.muted }, inline: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }, actionCard: { minHeight: 88, padding: 14, backgroundColor: colors.warningSoft, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', gap: 12 }, actionIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }, chipText: { fontFamily: 'Poppins_500Medium', fontSize: 9 }, chipPurple: { backgroundColor: colors.primarySoft, color: colors.primary }, chipWarning: { backgroundColor: colors.warningSoft, color: colors.warning }, chipSuccess: { backgroundColor: colors.successSoft, color: colors.success }, chipDanger: { backgroundColor: colors.dangerSoft, color: colors.danger }, chipInfo: { backgroundColor: colors.infoSoft, color: colors.info },
  childSwitchRow: { gap: 10, paddingRight: 20 }, childPill: { minWidth: 176, minHeight: 62, padding: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface }, childPillActive: { backgroundColor: colors.primary, borderColor: colors.primary }, avatarSmall: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, avatarSmallActive: { backgroundColor: '#fff' }, avatarText: { fontFamily: 'Poppins_600SemiBold', fontSize: 11, color: colors.primary }, avatarTextActive: { color: colors.primary }, childName: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: colors.ink }, childNameActive: { color: '#fff' }, childClass: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: colors.muted }, childClassActive: { color: '#E9D8FF' }, childSummary: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 13 }, avatarLarge: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, avatarLargeText: { fontFamily: 'Poppins_700Bold', fontSize: 16, color: colors.primary },
  timelineCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, gap: 10, backgroundColor: colors.surface }, timelineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, timelineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9 }, unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  notificationRow: { minHeight: 78, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 }, notificationUnread: { backgroundColor: '#FAF7FF', borderRadius: 14 }, empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 70, paddingHorizontal: 28 }, emptyIcon: { width: 76, height: 76, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }, emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: colors.ink }, emptyBody: { fontFamily: 'Poppins_400Regular', fontSize: 12, lineHeight: 20, color: colors.muted, textAlign: 'center', marginTop: 7 },
  attendanceHero: { alignSelf: 'center', width: 150, height: 150, borderRadius: 75, borderWidth: 16, borderColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginVertical: 12 }, attendancePercent: { fontFamily: 'Poppins_700Bold', fontSize: 30, color: colors.primary }, statsRow: { flexDirection: 'row', gap: 10 }, stat: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12, gap: 6, alignItems: 'center' }, statValue: { fontFamily: 'Poppins_700Bold', fontSize: 19, color: colors.ink }, profileCard: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 8 }, roleSwitch: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: 14, padding: 4 }, roleChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, roleChoiceActive: { backgroundColor: colors.primary }, roleText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.muted }, roleTextActive: { color: '#fff' }, settingRow: { minHeight: 68, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  uploadTile: { minHeight: 74, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FBFBFD' }, uploadIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, uploadFailed: { backgroundColor: colors.dangerSoft, borderColor: '#F6BFC6' }, progress: { height: 5, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', marginVertical: 5 }, progressFill: { width: '64%', height: 5, borderRadius: 4, backgroundColor: colors.primary }, checkRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 13 }, checkRowActive: { borderColor: colors.primary, backgroundColor: '#FAF7FF' }, checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary }, draftText: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: colors.muted, textAlign: 'center' },
  successPage: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: colors.surface }, successIcon: { width: 88, height: 88, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, successTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: colors.ink, textAlign: 'center' }, successBody: { fontFamily: 'Poppins_400Regular', fontSize: 13, lineHeight: 22, color: colors.muted, textAlign: 'center', marginBottom: 14, maxWidth: 320 }, notice: { minHeight: 58, borderRadius: 14, backgroundColor: colors.infoSoft, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, noticeText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 11, lineHeight: 18, color: colors.ink }, rosterRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, statusControl: { flexDirection: 'row', gap: 5 }, statusOption: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }, statusPresent: { backgroundColor: colors.success }, statusAbsent: { backgroundColor: colors.danger }, statusOptionText: { fontFamily: 'Poppins_600SemiBold', fontSize: 11, color: colors.muted }, statusOptionTextActive: { color: '#fff' }, filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  successCard: { borderRadius: radius.card, padding: 16, gap: 8, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: '#BDE7D2' }, invitationCode: { fontFamily: 'Poppins_700Bold', fontSize: 20, letterSpacing: 1, color: colors.primary }, successText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.success },
  detailIcon: { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, detailTitle: { fontFamily: 'Poppins_700Bold', fontSize: 23, lineHeight: 31, color: colors.ink }, detailMeta: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: colors.primary }, detailBody: { fontFamily: 'Poppins_400Regular', fontSize: 15, lineHeight: 25, color: colors.ink }, absenceHero: { minHeight: 105, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.warningSoft, borderRadius: radius.card, padding: 15 }, responseCard: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: radius.card, backgroundColor: colors.successSoft }, successMini: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  filePage: { flex: 1, paddingHorizontal: 20, backgroundColor: '#F1EFF5' }, fileCanvas: { flex: 1, marginVertical: 12, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 28 }, fileTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: colors.ink, textAlign: 'center', marginTop: 18 }, fileMeta: { fontFamily: 'Poppins_400Regular', fontSize: 12, lineHeight: 20, color: colors.muted, textAlign: 'center', marginTop: 8 }, fileActions: { paddingBottom: 20 },
  bottomNav: { height: 82, paddingTop: 9, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', backgroundColor: colors.surface }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }, navLabel: { fontFamily: 'Poppins_400Regular', fontSize: 9, color: colors.muted }, navLabelActive: { fontFamily: 'Poppins_600SemiBold', color: colors.primary },
});
