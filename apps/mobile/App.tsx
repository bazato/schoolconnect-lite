import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
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
} from "lucide-react-native";
import { useFonts } from "expo-font";
import {
  AttendanceStatus,
  Child,
  children,
  PostType,
  posts,
  Role,
  Route,
  scopedTimeline,
  TabKey,
  TimelinePost,
} from "./src/domain";
import { colors, radius } from "./src/theme";
import {
  clearSession,
  demoMode,
  isNetworkError,
  loadSession,
  mobileApi,
  MobileSession,
  requestOtp,
  saveSession,
  verifyOtp,
  type ApiDraft,
  type ApiSchool,
  type ApiSchoolClass,
  type ApiTeacherPost,
  type ApiTeachingAssignment,
} from "./src/api";
import { secureOfflineStorage } from "./src/secureOfflineStorage";
import {
  resolveAssignment,
  routeFromDeepLink,
  timelinePost,
} from "./src/workflows";
import {
  OfflineQueuePanel,
  OwnerOperations,
  SchoolOperations,
} from "./src/AdminWorkflows";
import PoppinsRegular from "./assets/fonts/Poppins-Regular.ttf";
import PoppinsMedium from "./assets/fonts/Poppins-Medium.ttf";
import PoppinsSemiBold from "./assets/fonts/Poppins-SemiBold.ttf";
import PoppinsBold from "./assets/fonts/Poppins-Bold.ttf";

const postLabels: Record<PostType, string> = {
  HOMEWORK: "Homework",
  RESULT: "Result",
  ANNOUNCEMENT: "Announcement",
};
const postIcons = {
  HOMEWORK: BookOpen,
  RESULT: GraduationCap,
  ANNOUNCEMENT: Megaphone,
};
const roleLabels: Record<Role, string> = {
  PLATFORM_OWNER: "Platform Owner",
  SCHOOL_ADMIN: "School Admin",
  TEACHER: "Teacher",
  PARENT: "Parent",
};
const POLL_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.EXPO_PUBLIC_POLL_INTERVAL_MS ?? 60_000),
);
const createIdempotencyKey = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? colors.primary : "#fff"} />
      ) : (
        <Text
          style={[styles.buttonText, secondary && styles.buttonSecondaryText]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  required,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
  error?: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A7A3AE"
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.textarea,
          error && styles.inputError,
        ]}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function Header({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={styles.iconButton}
          >
            <ArrowLeft size={22} color={colors.ink} />
          </Pressable>
        ) : (
          <View style={styles.brandMark}>
            <GraduationCap size={22} color="#fff" />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
        {action ?? <View style={styles.iconPlaceholder} />}
      </View>
    </View>
  );
}

function Chip({
  label,
  tone = "purple",
}: {
  label: string;
  tone?: "purple" | "warning" | "success" | "danger" | "info";
}) {
  const toneStyle =
    tone === "warning"
      ? styles.chipWarning
      : tone === "success"
        ? styles.chipSuccess
        : tone === "danger"
          ? styles.chipDanger
          : tone === "info"
            ? styles.chipInfo
            : styles.chipPurple;
  return (
    <View style={[styles.chip, toneStyle]}>
      <Text style={[styles.chipText, toneStyle]}>{label}</Text>
    </View>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: any;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon size={34} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function LoginScreen({
  onSignedIn,
}: {
  onSignedIn: (role: Role, session?: MobileSession) => void;
}) {
  const [phase, setPhase] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+91 98765 43210");
  const [invitation, setInvitation] = useState(demoMode ? "PARENT-INVITE" : "");
  const [otp, setOtp] = useState("123456");
  const [challengeId, setChallengeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const submit = async () => {
    setLoading(true);
    setServerError("");
    try {
      if (phase === "phone") {
        if (demoMode) await new Promise((resolve) => setTimeout(resolve, 450));
        else {
          const challenge = await requestOtp(phone, invitation);
          setChallengeId(challenge.challengeId);
        }
        setPhase("otp");
      } else if (demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        onSignedIn("PARENT");
      } else {
        const session = await verifyOtp(challengeId, otp);
        await saveSession(session);
        onSignedIn(session.memberships[0]?.role ?? "PARENT", session);
      }
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please retry.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.login}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.loginHero}>
          <View style={styles.loginLogo}>
            <GraduationCap size={42} color="#fff" />
          </View>
          <Text style={styles.loginTitle}>Welcome to SchoolConnect</Text>
          <Text style={styles.loginBody}>
            One secure place for school updates, homework and attendance.
          </Text>
        </View>
        <View style={styles.loginCard}>
          <Text style={styles.sectionTitle}>
            {phase === "phone"
              ? "Sign in with mobile"
              : "Enter your OTP code here"}
          </Text>
          <Text style={styles.helper}>
            {phase === "phone"
              ? "Use the mobile number from your school invitation. The invitation is required only for first-time activation."
              : `We sent a six-digit code to ${phone}.`}
          </Text>
          {phase === "phone" ? (
            <>
              <Field
                label="Mobile number"
                value={phone}
                onChangeText={setPhone}
                placeholder="+91"
                required
              />
              <Field
                label="Invitation code"
                value={invitation}
                onChangeText={setInvitation}
                placeholder="First sign-in only"
              />
            </>
          ) : (
            <Field
              label="Verification code"
              value={otp}
              onChangeText={setOtp}
              placeholder="6-digit code"
              required
            />
          )}
          {serverError ? (
            <Text style={styles.errorText}>{serverError}</Text>
          ) : null}
          <PrimaryButton
            label={phase === "phone" ? "Send OTP" : "Verify and continue"}
            onPress={() => {
              void submit();
            }}
            loading={loading}
            disabled={phase === "phone" ? phone.length < 8 : otp.length !== 6}
          />
          {phase === "otp" ? (
            <Pressable onPress={() => setPhase("phone")}>
              <Text style={styles.link}>Change mobile number</Text>
            </Pressable>
          ) : null}
          <View style={styles.securityNote}>
            <ShieldCheck size={18} color={colors.primary} />
            <Text style={styles.securityText}>
              Your role and school access are resolved securely after sign-in.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OfflineBanner() {
  return (
    <View style={styles.offline}>
      <WifiOff size={16} color={colors.warning} />
      <Text style={styles.offlineText}>
        Offline view · showing recent permitted content
      </Text>
    </View>
  );
}

function TeacherHome({
  navigate,
  publishedPosts,
  teacherName = "Ms. Priya",
  assignment,
  session,
  onNotifications,
}: {
  navigate: (route: Route) => void;
  publishedPosts?: ApiTeacherPost[];
  teacherName?: string;
  assignment?: ApiTeachingAssignment;
  session: MobileSession | null;
  onNotifications: () => void;
}) {
  const [followUps, setFollowUps] = useState<Array<{
    responseStatus: string;
  }> | null>(null);
  useEffect(() => {
    setFollowUps(null);
    if (!session || !assignment?.canRecordAttendance) return;
    let active = true;
    const refresh = () => {
      void mobileApi
        .attendanceFollowUps(
          session,
          assignment.classId,
          new Date().toISOString().slice(0, 10),
        )
        .then((items) => {
          if (active) setFollowUps(items);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, assignment?.classId, assignment?.canRecordAttendance]);
  const className = assignment?.className ?? "No active class";
  const subjectName =
    assignment?.subjectName ?? "Ask the school administrator for an assignment";
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header
        title={`Hello, ${teacherName}`}
        subtitle={`${className} · ${subjectName}`}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
            onPress={onNotifications}
            style={styles.iconButton}
          >
            <Bell size={22} color={colors.primary} />
          </Pressable>
        }
      />
      <View style={styles.scopeCard}>
        <View>
          <Text style={styles.eyebrow}>ACTIVE CLASS</Text>
          <Text style={styles.scopeTitle}>{className}</Text>
          <Text style={styles.scopeMeta}>{subjectName}</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Quick actions</Text>
      <View style={styles.quickGrid}>
        {assignment ? (
          <QuickAction
            icon={BookOpen}
            label="Homework"
            onPress={() => navigate({ name: "compose", type: "HOMEWORK" })}
          />
        ) : null}
        {assignment?.canPublishResults ? (
          <QuickAction
            icon={GraduationCap}
            label="Results"
            onPress={() => navigate({ name: "compose", type: "RESULT" })}
          />
        ) : null}
        {assignment?.canPublishAnnouncements ? (
          <QuickAction
            icon={Megaphone}
            label="Announcement"
            onPress={() => navigate({ name: "compose", type: "ANNOUNCEMENT" })}
          />
        ) : null}
        {assignment?.canRecordAttendance ? (
          <QuickAction
            icon={ClipboardCheck}
            label="Attendance"
            onPress={() => navigate({ name: "teacher-attendance" })}
          />
        ) : null}
      </View>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Today</Text>
        <Pressable onPress={() => navigate({ name: "follow-ups" })}>
          <Text style={styles.linkInline}>View follow-ups</Text>
        </Pressable>
      </View>
      {assignment?.canRecordAttendance ? (
        <Pressable
          onPress={() => navigate({ name: "follow-ups" })}
          style={styles.actionCard}
        >
          <View style={styles.actionIcon}>
            <CircleAlert size={23} color={colors.warning} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>
              {followUps
                ? `${followUps.length} absence follow-ups`
                : "Absence follow-ups"}
            </Text>
            <Text style={styles.cardBody}>
              {followUps
                ? `${followUps.filter((item) => item.responseStatus === "PENDING").length} pending guardian responses.`
                : "Open the live assigned-class response list."}
            </Text>
          </View>
          <ChevronRight size={20} color={colors.muted} />
        </Pressable>
      ) : null}
      <Text style={styles.sectionTitle}>Recent publishing</Text>
      {publishedPosts === undefined ? (
        <>
          <ActivityRow
            type="HOMEWORK"
            title="Fractions practice"
            meta="Published · 28 recipients"
          />
          <ActivityRow
            type="ANNOUNCEMENT"
            title="Holiday announcement"
            meta="Updated · 31 viewed"
          />
          <ActivityRow
            type="RESULT"
            title="Midyear results"
            meta="Published · Private files"
          />
        </>
      ) : publishedPosts.length ? (
        publishedPosts
          .slice(0, 5)
          .map((post) => (
            <ActivityRow
              key={post.id}
              type={post.postType}
              title={post.title}
              meta={`${post.status} · ${post.recipientCount} recipients`}
              onPress={() => navigate({ name: "edit-post", postId: post.id })}
            />
          ))
      ) : (
        <EmptyState
          icon={BookOpen}
          title="Nothing published yet"
          body="Your published homework and announcements will appear here."
        />
      )}
    </ScrollView>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: any;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.quickIcon}>
        <Icon size={23} color={colors.primary} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function ActivityRow({
  type,
  title,
  meta,
  onPress,
}: {
  type: PostType;
  title: string;
  meta: string;
  onPress?: () => void;
}) {
  const Icon = postIcons[type];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={!onPress} onPress={onPress} style={styles.listRow}>
      <View style={styles.listIcon}>
        <Icon size={20} color={colors.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardMeta}>{meta}</Text>
      </View>
      <ChevronRight size={19} color={colors.muted} />
    </Pressable>
  );
}

function ParentHome({
  childId,
  setChildId,
  navigate,
  offline,
  availableChildren = children,
  feed,
  pendingAbsenceId,
  parentName = "Ahmed",
  onNotifications,
}: {
  childId: string;
  setChildId: (id: string) => void;
  navigate: (route: Route) => void;
  offline: boolean;
  availableChildren?: Child[];
  feed?: TimelinePost[];
  pendingAbsenceId?: string;
  parentName?: string;
  onNotifications: () => void;
}) {
  const selected =
    availableChildren.find((child) => child.id === childId) ??
    availableChildren[0];
  if (!selected)
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Header title="Welcome" subtitle="Loading your school context" />
        <EmptyState
          icon={Users}
          title="No linked children"
          body="Ask the school to verify your guardian invitation and child link."
        />
      </ScrollView>
    );
  const timeline = feed ?? scopedTimeline(selected.id);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header
        title={`Welcome, ${parentName}`}
        subtitle="Here’s what’s new today"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
            onPress={onNotifications}
            style={styles.iconButton}
          >
            <Bell size={22} color={colors.primary} />
          </Pressable>
        }
      />
      {offline ? <OfflineBanner /> : null}
      <Text style={styles.eyebrow}>SELECTED CHILD</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.childSwitchRow}
      >
        {availableChildren.map((child) => (
          <Pressable
            key={child.id}
            onPress={() => setChildId(child.id)}
            accessibilityLabel={`${child.name}, ${child.id === selected.id ? "selected" : "not selected"}`}
            style={[
              styles.childPill,
              child.id === selected.id && styles.childPillActive,
            ]}
          >
            <View
              style={[
                styles.avatarSmall,
                child.id === selected.id && styles.avatarSmallActive,
              ]}
            >
              <Text
                style={[
                  styles.avatarText,
                  child.id === selected.id && styles.avatarTextActive,
                ]}
              >
                {child.avatar}
              </Text>
            </View>
            <View>
              <Text
                style={[
                  styles.childName,
                  child.id === selected.id && styles.childNameActive,
                ]}
              >
                {child.name}
              </Text>
              <Text
                style={[
                  styles.childClass,
                  child.id === selected.id && styles.childClassActive,
                ]}
              >
                {child.className}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.childSummary}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarLargeText}>{selected.avatar}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.scopeTitle}>{selected.name}</Text>
          <Text style={styles.scopeMeta}>{selected.school}</Text>
        </View>
      </View>
      {pendingAbsenceId ? (
        <Pressable
          onPress={() =>
            navigate({ name: "absence", eventId: pendingAbsenceId })
          }
          style={styles.actionCard}
        >
          <View style={styles.actionIcon}>
            <CircleAlert size={23} color={colors.warning} />
          </View>
          <View style={styles.flex}>
            <View style={styles.inline}>
              <Text style={styles.cardTitle}>Absence needs attention</Text>
              <Chip label="Pending" tone="warning" />
            </View>
            <Text style={styles.cardBody}>
              Tap to acknowledge or add a reason
            </Text>
          </View>
          <ChevronRight size={20} color={colors.muted} />
        </Pressable>
      ) : null}
      <Text style={styles.sectionTitle}>Today</Text>
      {timeline.length ? (
        timeline.map((post) => (
          <TimelineCard
            key={post.id}
            post={post}
            onPress={() => navigate({ name: "post-detail", postId: post.id })}
          />
        ))
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No updates yet"
          body="School updates for this child will appear here."
        />
      )}
    </ScrollView>
  );
}

function TimelineCard({
  post,
  onPress,
}: {
  post: (typeof posts)[number];
  onPress: () => void;
}) {
  const Icon = postIcons[post.type];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${postLabels[post.type]}: ${post.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.timelineCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.timelineHead}>
        <View style={styles.listIcon}>
          <Icon size={20} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <View style={styles.inline}>
            <Text style={styles.cardEyebrow}>{postLabels[post.type]}</Text>
            {post.updated ? <Chip label="Updated" tone="info" /> : null}
            {post.unread ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={styles.cardTitleLarge}>{post.title}</Text>
        </View>
        <Text style={styles.cardTime}>{post.timestamp}</Text>
      </View>
      <Text style={styles.cardBody}>{post.body}</Text>
      <View style={styles.timelineFoot}>
        <Text style={styles.cardMeta}>
          {post.subject ?? post.author}
          {post.dueDate ? ` · Due ${post.dueDate}` : ""}
        </Text>
        <ChevronRight size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function PostsScreen({
  role,
  childId,
  navigate,
  feed,
  publishedPosts,
  assignment,
  drafts,
}: {
  role: Role;
  childId: string;
  navigate: (route: Route) => void;
  feed?: TimelinePost[];
  publishedPosts?: ApiTeacherPost[];
  assignment?: ApiTeachingAssignment;
  drafts?: ApiDraft[];
}) {
  if (role === "TEACHER")
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Header title="Posts" subtitle="Create and manage school content" />
        <View style={styles.quickGrid}>
          {assignment ? (
            <QuickAction
              icon={BookOpen}
              label="Homework"
              onPress={() => navigate({ name: "compose", type: "HOMEWORK" })}
            />
          ) : null}
          {assignment?.canPublishResults ? (
            <QuickAction
              icon={GraduationCap}
              label="Results"
              onPress={() => navigate({ name: "compose", type: "RESULT" })}
            />
          ) : null}
          {assignment?.canPublishAnnouncements ? (
            <QuickAction
              icon={Megaphone}
              label="Announcement"
              onPress={() =>
                navigate({ name: "compose", type: "ANNOUNCEMENT" })
              }
            />
          ) : null}
        </View>
        <Text style={styles.sectionTitle}>All posts</Text>
        {publishedPosts === undefined ? (
          <>
            <ActivityRow
              type="HOMEWORK"
              title="Fractions practice"
              meta="Today · 28 recipients"
            />
            <ActivityRow
              type="RESULT"
              title="Midyear results"
              meta="Yesterday · Private"
            />
          </>
        ) : publishedPosts.length ? (
          publishedPosts.map((post) => (
            <ActivityRow
              key={post.id}
              type={post.postType}
              title={post.title}
              meta={`${post.status === "SCHEDULED" ? `Scheduled ${new Date(post.scheduledFor ?? "").toLocaleString()}` : post.status === "ARCHIVED" ? "Archived" : post.status === "UPDATED" ? "Updated" : post.publishedAt ? new Date(post.publishedAt).toLocaleString() : "Published"} · ${post.recipientCount} recipients`}
              onPress={() => navigate({ name: "edit-post", postId: post.id })}
            />
          ))
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Nothing published yet"
            body="Use a quick action above to publish your first update."
          />
        )}
        <Text style={styles.sectionTitle}>Drafts</Text>
        {drafts === undefined ? (
          <ActivityRow
            type="ANNOUNCEMENT"
            title="Sports day reminder"
            meta="Draft · Saved on this device"
          />
        ) : drafts.length ? (
          drafts.map((draft) => (
            <ActivityRow
              key={draft.id}
              type={draft.postType}
              title={draft.payload.title || "Untitled draft"}
              meta={`Saved ${new Date(draft.updatedAt).toLocaleString()}`}
              onPress={() =>
                navigate({
                  name: "compose",
                  type: draft.postType,
                  draftId: draft.id,
                })
              }
            />
          ))
        ) : (
          <Text style={styles.cardMeta}>
            No server drafts. Local drafts reopen from the matching quick
            action.
          </Text>
        )}
      </ScrollView>
    );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header
        title="School updates"
        subtitle="Homework, results and announcements"
      />
      {(feed ?? scopedTimeline(childId)).map((post) => (
        <TimelineCard
          key={post.id}
          post={post}
          onPress={() => navigate({ name: "post-detail", postId: post.id })}
        />
      ))}
    </ScrollView>
  );
}

function NotificationsScreen({
  role,
  navigate,
  session,
}: {
  role: Role;
  navigate: (route: Route) => void;
  session: MobileSession | null;
}) {
  const demoItems =
    role === "PARENT"
      ? [
          {
            type: "ATTENDANCE",
            title: "Jenny was marked absent",
            meta: "Today · Action required",
            unread: true,
            action: () =>
              navigate({ name: "absence", eventId: "attendance-1" }),
          },
          {
            type: "RESULT",
            title: "Midyear results published",
            meta: "Yesterday · Jenny Wilson",
            unread: true,
            action: () =>
              navigate({ name: "post-detail", postId: "post-result" }),
          },
          {
            type: "ANNOUNCEMENT",
            title: "Holiday announcement updated",
            meta: "3 days ago · School",
            unread: false,
            action: () =>
              navigate({ name: "post-detail", postId: "post-announcement" }),
          },
        ]
      : [
          {
            type: "PUBLISH",
            title: "Homework published",
            meta: "Today · 28 recipients",
            unread: true,
            action: () => undefined,
          },
          {
            type: "VIEW",
            title: "31 guardians viewed your announcement",
            meta: "Today · Grade 5A",
            unread: false,
            action: () => undefined,
          },
        ];
  const [liveItems, setLiveItems] = useState<
    Array<{
      id: string;
      title: string;
      meta: string;
      unread: boolean;
      type: string;
      resourceType: string;
      resourceId: string;
      studentId?: string;
    }>
  >([]);
  useEffect(() => {
    if (session)
      void mobileApi
        .notificationInbox(session)
        .then((items) =>
          setLiveItems(
            items.map((item) => ({
              id: item.id,
              title: item.title,
              meta: `${new Date(item.createdAt).toLocaleString()} · ${item.body}`,
              unread: !item.readAt,
              type: item.notificationType,
              resourceType: item.resourceType,
              resourceId: item.resourceId,
              studentId: item.studentId,
            })),
          ),
        )
        .catch(() => undefined);
  }, [session]);
  const items = session
    ? liveItems.map((item) => ({
        ...item,
        action: () => {
          void mobileApi
            .markNotificationRead(session, item.id)
            .then(() =>
              setLiveItems((current) =>
                current.map((notice) =>
                  notice.id === item.id ? { ...notice, unread: false } : notice,
                ),
              ),
            )
            .catch(() => undefined);
          if (item.resourceType === "ATTENDANCE_EVENT")
            navigate({ name: "absence", eventId: item.resourceId });
          else if (item.resourceType === "POST")
            navigate({
              name: role === "TEACHER" ? "edit-post" : "post-detail",
              postId: item.resourceId,
              ...(role === "PARENT" ? { studentId: item.studentId } : {}),
            });
        },
      }))
    : demoItems;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header
        title="Notifications"
        subtitle={`${items.filter((item) => item.unread).length} unread`}
      />
      {items.length ? (
        items.map((item, index) => (
          <Pressable
            key={`${item.title}-${index}`}
            onPress={item.action}
            style={[
              styles.notificationRow,
              item.unread && styles.notificationUnread,
            ]}
          >
            <View style={styles.listIcon}>
              {item.type.includes("ATTENDANCE") ? (
                <CircleAlert size={20} color={colors.warning} />
              ) : (
                <Bell size={20} color={colors.primary} />
              )}
            </View>
            <View style={styles.flex}>
              <View style={styles.inline}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {item.unread ? <View style={styles.unreadDot} /> : null}
              </View>
              <Text style={styles.cardMeta}>{item.meta}</Text>
            </View>
            <ChevronRight size={19} color={colors.muted} />
          </Pressable>
        ))
      ) : (
        <EmptyState
          icon={Bell}
          title="No notifications, yet!"
          body="We’ll let you know when something new happens."
        />
      )}
    </ScrollView>
  );
}

function AttendanceTab({
  role,
  navigate,
  className = "Grade 5A",
  history = [],
}: {
  role: Role;
  navigate: (route: Route) => void;
  className?: string;
  history?: Array<{
    id: string;
    attendanceDate: string;
    attendanceStatus: string;
  }>;
}) {
  if (role === "TEACHER")
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Header title="Attendance" subtitle={`${className} · Today`} />
        <Pressable
          onPress={() => navigate({ name: "teacher-attendance" })}
          style={styles.scopeCard}
        >
          <View>
            <Text style={styles.scopeTitle}>Take attendance</Text>
            <Text style={styles.scopeMeta}>{className} · Not submitted</Text>
          </View>
          <ChevronRight size={20} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => navigate({ name: "follow-ups" })}
          style={styles.listRow}
        >
          <View style={styles.listIcon}>
            <Users size={20} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Absence follow-ups</Text>
            <Text style={styles.cardMeta}>Assigned-class responses</Text>
          </View>
          <ChevronRight size={19} color={colors.muted} />
        </Pressable>
      </ScrollView>
    );
  const present = history.filter(
    (item) => item.attendanceStatus === "PRESENT",
  ).length;
  const absent = history.filter(
    (item) => item.attendanceStatus === "ABSENT",
  ).length;
  const leave = history.filter(
    (item) => item.attendanceStatus === "LEAVE",
  ).length;
  const percent = history.length
    ? Math.round((present / history.length) * 100)
    : 0;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Attendance" subtitle="Selected child · Recent records" />
      <View style={styles.attendanceHero}>
        <Text style={styles.attendancePercent}>{percent}%</Text>
        <Text style={styles.cardMeta}>Present</Text>
      </View>
      <View style={styles.statsRow}>
        <Stat value={String(present)} label="Present" tone="success" />
        <Stat value={String(absent)} label="Absent" tone="danger" />
        <Stat value={String(leave)} label="Leave" tone="warning" />
      </View>
      <Text style={styles.sectionTitle}>Recent</Text>
      {history.map((item) => (
        <Pressable
          key={item.id}
          onPress={() =>
            item.attendanceStatus === "ABSENT" &&
            navigate({ name: "absence", eventId: item.id })
          }
          style={styles.listRow}
        >
          <View style={styles.listIcon}>
            <CircleAlert
              size={20}
              color={
                item.attendanceStatus === "ABSENT"
                  ? colors.warning
                  : colors.success
              }
            />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>
              {item.attendanceStatus} ·{" "}
              {new Date(item.attendanceDate).toLocaleDateString()}
            </Text>
            <Text style={styles.cardMeta}>
              {item.attendanceStatus === "ABSENT"
                ? "Tap to view or acknowledge"
                : "Official attendance record"}
            </Text>
          </View>
          <ChevronRight size={19} color={colors.muted} />
        </Pressable>
      ))}
      {!history.length ? (
        <EmptyState
          icon={CalendarCheck}
          title="No attendance records"
          body="Submitted attendance for this child will appear here."
        />
      ) : null}
    </ScrollView>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "success" | "danger" | "warning";
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Chip label={label} tone={tone} />
    </View>
  );
}

function ProfileScreen({
  role,
  setRole,
  availableRoles,
  displayName,
  switchingRole,
  roleError,
  offline,
  setOffline,
  logout,
  session,
}: {
  role: Role;
  setRole: (role: Role) => void;
  availableRoles: Role[];
  displayName: string;
  switchingRole: boolean;
  roleError: string;
  offline: boolean;
  setOffline: (value: boolean) => void;
  logout: () => void;
  session: MobileSession | null;
}) {
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Account" subtitle="School and preferences" />
      <View style={styles.profileCard}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarLargeText}>{initials}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.scopeTitle}>{displayName}</Text>
          <Text style={styles.scopeMeta}>Thomas Jefferson High School</Text>
        </View>
      </View>
      {availableRoles.length > 1 ? (
        <>
          <Text style={styles.sectionTitle}>Active role</Text>
          <View style={styles.roleSwitch}>
            {availableRoles.map((option) => (
              <Pressable
                key={option}
                disabled={switchingRole}
                onPress={() => setRole(option)}
                style={[
                  styles.roleChoice,
                  role === option && styles.roleChoiceActive,
                ]}
              >
                <Text
                  style={[
                    styles.roleText,
                    role === option && styles.roleTextActive,
                  ]}
                >
                  {roleLabels[option]}
                </Text>
              </Pressable>
            ))}
          </View>
          {switchingRole ? <ActivityIndicator color={colors.primary} /> : null}
          {roleError ? <Text style={styles.errorText}>{roleError}</Text> : null}
          <Text style={styles.helper}>
            Role switching is available only because this account has more than
            one verified school membership.
          </Text>
        </>
      ) : (
        <View style={styles.notice}>
          <ShieldCheck size={19} color={colors.info} />
          <Text style={styles.noticeText}>
            {roleLabels[role]} account · Access is fixed by the school
            invitation.
          </Text>
        </View>
      )}
      <Text style={styles.sectionTitle}>Preferences</Text>
      <View style={styles.settingRow}>
        <View>
          <Text style={styles.cardTitle}>Demo offline state</Text>
          <Text style={styles.cardMeta}>Preview cached-content messaging</Text>
        </View>
        <Switch
          value={offline}
          onValueChange={setOffline}
          trackColor={{ false: "#D9D6DE", true: colors.primarySoft }}
          thumbColor={offline ? colors.primary : "#fff"}
        />
      </View>
      <View style={styles.settingRow}>
        <View>
          <Text style={styles.cardTitle}>Push notifications</Text>
          <Text style={styles.cardMeta}>
            School updates and action-required alerts
          </Text>
        </View>
        <Switch
          value
          trackColor={{ true: colors.primarySoft }}
          thumbColor={colors.primary}
        />
      </View>
      {session ? <OfflineQueuePanel session={session} /> : null}
      <PrimaryButton label="Log out securely" secondary onPress={logout} />
    </ScrollView>
  );
}

function PlatformOwnerDashboard({
  session,
  logout,
}: {
  session: MobileSession;
  logout: () => void;
}) {
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const [schoolCode, setSchoolCode] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Riyadh");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [result, setResult] = useState<{
    schoolName: string;
    adminName: string;
    adminPhone: string;
    invitationCode: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = () => {
    void mobileApi
      .schools(session)
      .then(setSchools)
      .catch((failure) =>
        setError(
          failure instanceof Error ? failure.message : "SCHOOLS_LOAD_FAILED",
        ),
      );
  };
  useEffect(refresh, [session]);
  const createSchool = async () => {
    setError("");
    setResult(null);
    setSaving(true);
    try {
      const created = await mobileApi.createSchool(session, {
        schoolCode,
        displayName: schoolName,
        timezone,
        adminDisplayName: adminName,
        adminPhoneE164: adminPhone.replace(/\s/g, ""),
      });
      setResult({
        schoolName: created.school.displayName,
        adminName,
        adminPhone,
        invitationCode: created.administrator.invitationCode,
        expiresAt: created.administrator.expiresAt,
      });
      setSchoolCode("");
      setSchoolName("");
      setAdminName("");
      setAdminPhone("");
      refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "SCHOOL_CREATION_FAILED",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Header
          title="Platform administration"
          subtitle="Schools and first administrators"
        />
        <View style={styles.notice}>
          <ShieldCheck size={19} color={colors.info} />
          <Text style={styles.noticeText}>
            Platform Owner can provision schools, but cannot access school
            posts, students, results or attendance.
          </Text>
        </View>
        <Text style={styles.sectionTitle}>Add a school</Text>
        <Field
          label="School code"
          value={schoolCode}
          onChangeText={setSchoolCode}
          placeholder="e.g. NORTH001"
          required
        />
        <Field
          label="School name"
          value={schoolName}
          onChangeText={setSchoolName}
          placeholder="Official school name"
          required
        />
        <Field
          label="Timezone"
          value={timezone}
          onChangeText={setTimezone}
          placeholder="e.g. Asia/Riyadh"
          required
        />
        <Text style={styles.sectionTitle}>First school administrator</Text>
        <Field
          label="Administrator name"
          value={adminName}
          onChangeText={setAdminName}
          placeholder="Full name"
          required
        />
        <Field
          label="Administrator mobile"
          value={adminPhone}
          onChangeText={setAdminPhone}
          placeholder="+966..."
          required
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <PrimaryButton
          label="Create school and administrator"
          onPress={() => {
            void createSchool();
          }}
          loading={saving}
          disabled={
            !schoolCode.trim() ||
            !schoolName.trim() ||
            !adminName.trim() ||
            adminPhone.length < 8
          }
        />
        {result ? (
          <View style={styles.successCard}>
            <Text style={styles.cardTitleLarge}>School created</Text>
            <Text style={styles.cardBody}>{result.schoolName}</Text>
            <Text style={styles.cardTitle}>Administrator login</Text>
            <Text style={styles.cardBody}>
              {result.adminName} · {result.adminPhone}
            </Text>
            <Text style={styles.invitationCode}>{result.invitationCode}</Text>
            <Text style={styles.cardMeta}>
              Invitation expires{" "}
              {new Date(result.expiresAt).toLocaleDateString()}. Development
              OTP: 123456
            </Text>
          </View>
        ) : null}
        <Text style={styles.sectionTitle}>Schools</Text>
        {schools.map((school) => (
          <View key={school.id} style={styles.listRow}>
            <View style={styles.listIcon}>
              <GraduationCap size={20} color={colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{school.displayName}</Text>
              <Text style={styles.cardMeta}>
                {school.schoolCode} · {school.timezone} · {school.status}
              </Text>
            </View>
          </View>
        ))}
        <OwnerOperations session={session} />
        <PrimaryButton label="Log out securely" secondary onPress={logout} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SchoolAdminDashboard({
  session,
  logout,
}: {
  session: MobileSession;
  logout: () => void;
}) {
  const [schoolName, setSchoolName] = useState("School administration");
  const [classes, setClasses] = useState<ApiSchoolClass[]>([]);
  const [classCode, setClassCode] = useState("");
  const [className, setClassName] = useState("");
  const [academicYear, setAcademicYear] = useState("2026-2027");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherPhone, setTeacherPhone] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [canPublishResults, setCanPublishResults] = useState(false);
  const [canPublishAnnouncements, setCanPublishAnnouncements] = useState(true);
  const [canRecordAttendance, setCanRecordAttendance] = useState(true);
  const [invitation, setInvitation] = useState<{
    displayName: string;
    phone: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingClass, setSavingClass] = useState(false);
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [studentName, setStudentName] = useState("");
  const [admissionNumber, setAdmissionNumber] = useState("");
  const [savingParent, setSavingParent] = useState(false);
  const refreshClasses = () => {
    void mobileApi
      .adminClasses(session)
      .then((items) => {
        setClasses(items);
        setSelectedClassId((current) => current || items[0]?.id || "");
      })
      .catch((failure) =>
        setError(
          failure instanceof Error ? failure.message : "CLASSES_LOAD_FAILED",
        ),
      );
  };
  useEffect(() => {
    refreshClasses();
    void mobileApi
      .context(session)
      .then((context) =>
        setSchoolName(context.school?.displayName ?? "School administration"),
      );
  }, [session]);
  const createClass = async () => {
    setError("");
    setMessage("");
    setSavingClass(true);
    try {
      const created = await mobileApi.createClass(session, {
        classCode,
        displayName: className,
        academicYear,
      });
      setSelectedClassId(created.id);
      setClassCode("");
      setClassName("");
      setMessage(`${created.displayName} is ready for teacher assignments.`);
      refreshClasses();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "CLASS_CREATION_FAILED",
      );
    } finally {
      setSavingClass(false);
    }
  };
  const createTeacher = async () => {
    setError("");
    setMessage("");
    setInvitation(null);
    setSavingTeacher(true);
    try {
      const created = await mobileApi.createTeacher(session, {
        displayName: teacherName,
        phoneE164: teacherPhone.replace(/\s/g, ""),
        classId: selectedClassId,
        subjectCode,
        subjectName,
        canPublishResults,
        canPublishAnnouncements,
        canRecordAttendance,
      });
      setInvitation({
        displayName: teacherName,
        phone: teacherPhone,
        code: created.teacher.invitationCode,
        expiresAt: created.teacher.expiresAt,
      });
      setTeacherName("");
      setTeacherPhone("");
      setSubjectCode("");
      setSubjectName("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "TEACHER_CREATION_FAILED",
      );
    } finally {
      setSavingTeacher(false);
    }
  };
  const createParent = async () => {
    setError("");
    setMessage("");
    setInvitation(null);
    setSavingParent(true);
    try {
      const created = await mobileApi.createParent(session, {
        displayName: parentName,
        phoneE164: parentPhone.replace(/\s/g, ""),
        studentDisplayName: studentName,
        admissionNumber,
        classId: selectedClassId,
        relationship: "Parent",
      });
      setInvitation({
        displayName: parentName,
        phone: parentPhone,
        code: created.parent.invitationCode,
        expiresAt: created.parent.expiresAt,
      });
      setMessage(
        `${created.student.displayName} is linked securely to ${parentName}.`,
      );
      setParentName("");
      setParentPhone("");
      setStudentName("");
      setAdmissionNumber("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "PARENT_CREATION_FAILED",
      );
    } finally {
      setSavingParent(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Header title={schoolName} subtitle="School administrator" />
        <View style={styles.notice}>
          <ShieldCheck size={19} color={colors.info} />
          <Text style={styles.noticeText}>
            Every account, class and child link created here is locked to this
            school. Permissions start at the minimum selected below.
          </Text>
        </View>
        <Text style={styles.sectionTitle}>Add a class</Text>
        <Field
          label="Class code"
          value={classCode}
          onChangeText={setClassCode}
          placeholder="e.g. G5A"
          required
        />
        <Field
          label="Class name"
          value={className}
          onChangeText={setClassName}
          placeholder="e.g. Grade 5A"
          required
        />
        <Field
          label="Academic year"
          value={academicYear}
          onChangeText={setAcademicYear}
          placeholder="YYYY-YYYY"
          required
        />
        <PrimaryButton
          label="Create class"
          onPress={() => {
            void createClass();
          }}
          loading={savingClass}
          disabled={!classCode.trim() || !className.trim()}
        />
        <Text style={styles.sectionTitle}>Select a class</Text>
        {classes.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setSelectedClassId(item.id)}
            style={[
              styles.checkRow,
              selectedClassId === item.id && styles.checkRowActive,
            ]}
          >
            <View
              style={[
                styles.checkbox,
                selectedClassId === item.id && styles.checkboxActive,
              ]}
            >
              {selectedClassId === item.id ? (
                <Check size={15} color="#fff" />
              ) : null}
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{item.displayName}</Text>
              <Text style={styles.cardMeta}>
                {item.classCode} · {item.academicYear}
              </Text>
            </View>
          </Pressable>
        ))}
        {classes.length ? (
          <>
            <Text style={styles.sectionTitle}>Add a teacher</Text>
            <Field
              label="Teacher name"
              value={teacherName}
              onChangeText={setTeacherName}
              placeholder="Full name"
              required
            />
            <Field
              label="Teacher mobile"
              value={teacherPhone}
              onChangeText={setTeacherPhone}
              placeholder="+966..."
              required
            />
            <Field
              label="Subject code"
              value={subjectCode}
              onChangeText={setSubjectCode}
              placeholder="e.g. MATH"
              required
            />
            <Field
              label="Subject name"
              value={subjectName}
              onChangeText={setSubjectName}
              placeholder="e.g. Mathematics"
              required
            />
            <PermissionToggle
              label="Publish announcements"
              value={canPublishAnnouncements}
              onChange={setCanPublishAnnouncements}
            />
            <PermissionToggle
              label="Record attendance"
              value={canRecordAttendance}
              onChange={setCanRecordAttendance}
            />
            <PermissionToggle
              label="Publish private results"
              value={canPublishResults}
              onChange={setCanPublishResults}
            />
            <PrimaryButton
              label="Create teacher account"
              onPress={() => {
                void createTeacher();
              }}
              loading={savingTeacher}
              disabled={
                !selectedClassId ||
                !teacherName.trim() ||
                teacherPhone.length < 8 ||
                !subjectCode.trim() ||
                !subjectName.trim()
              }
            />
            <Text style={styles.sectionTitle}>Add a student and parent</Text>
            <Field
              label="Student name"
              value={studentName}
              onChangeText={setStudentName}
              placeholder="Student full name"
              required
            />
            <Field
              label="Admission number"
              value={admissionNumber}
              onChangeText={setAdmissionNumber}
              placeholder="e.g. SC-1024"
              required
            />
            <Field
              label="Parent name"
              value={parentName}
              onChangeText={setParentName}
              placeholder="Parent or guardian full name"
              required
            />
            <Field
              label="Parent mobile"
              value={parentPhone}
              onChangeText={setParentPhone}
              placeholder="+966..."
              required
            />
            <PrimaryButton
              label="Create parent and link student"
              onPress={() => {
                void createParent();
              }}
              loading={savingParent}
              disabled={
                !selectedClassId ||
                !studentName.trim() ||
                !admissionNumber.trim() ||
                !parentName.trim() ||
                parentPhone.length < 8
              }
            />
          </>
        ) : (
          <EmptyState
            icon={Users}
            title="Create a class first"
            body="Teacher assignments and student enrolments require an active class."
          />
        )}
        {message ? <Text style={styles.successText}>{message}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {invitation ? (
          <View style={styles.successCard}>
            <Text style={styles.cardTitleLarge}>Account created</Text>
            <Text style={styles.cardBody}>
              {invitation.displayName} · {invitation.phone}
            </Text>
            <Text style={styles.invitationCode}>{invitation.code}</Text>
            <Text style={styles.cardMeta}>
              Single-use invitation expires{" "}
              {new Date(invitation.expiresAt).toLocaleDateString()}. Development
              OTP: 123456
            </Text>
          </View>
        ) : null}
        <SchoolOperations
          session={session}
          classes={classes}
          onClassesChanged={refreshClasses}
        />
        <PrimaryButton label="Log out securely" secondary onPress={logout} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PermissionToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#D9D6DE", true: colors.primarySoft }}
        thumbColor={value ? colors.primary : "#fff"}
      />
    </View>
  );
}

function ComposeScreen({
  type,
  onBack,
  onDone,
  session,
  onPublished,
  editing,
  assignment,
  draft,
}: {
  type: PostType;
  onBack: () => void;
  onDone: () => void;
  session: MobileSession | null;
  onPublished: () => void;
  editing?: ApiTeacherPost;
  assignment?: ApiTeachingAssignment;
  draft?: ApiDraft;
}) {
  const [title, setTitle] = useState(
    editing?.title ?? draft?.payload.title ?? "",
  );
  const [body, setBody] = useState(editing?.body ?? draft?.payload.body ?? "");
  const [dueDate, setDueDate] = useState(() =>
    editing?.dueDate
      ? String(editing.dueDate).slice(0, 10)
      : (draft?.payload.dueDate ??
        (() => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          return tomorrow.toISOString().slice(0, 10);
        })()),
  );
  const [exam, setExam] = useState(
    editing?.examName ?? draft?.payload.examName ?? "Midyear examination",
  );
  const [urgent, setUrgent] = useState(
    editing?.urgent ?? draft?.payload.urgent ?? false,
  );
  const [audienceType, setAudienceType] = useState<
    "CLASS" | "GRADE" | "SCHOOL"
  >(draft?.payload.audienceType ?? "CLASS");
  const [scheduledFor, setScheduledFor] = useState(
    editing?.status === "SCHEDULED"
      ? (editing.scheduledFor ?? "")
      : (draft?.payload.scheduledFor ?? ""),
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [gradeEnabled, setGradeEnabled] = useState(false);
  const [schoolEnabled, setSchoolEnabled] = useState(false);
  const [urgentEnabled, setUrgentEnabled] = useState(false);
  const [publishedState, setPublishedState] = useState<
    "PUBLISHED" | "SCHEDULED" | "QUEUED" | "UPDATED" | "ARCHIVED"
  >("PUBLISHED");
  const [report, setReport] = useState<Awaited<
    ReturnType<typeof mobileApi.postReport>
  > | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [upload, setUpload] = useState<
    "EMPTY" | "UPLOADING" | "FAILED" | "READY"
  >(draft?.payload.uploadedFileId ? "READY" : "EMPTY");
  const [published, setPublished] = useState(false);
  const [error, setError] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [resultStudents, setResultStudents] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [targetStudentId, setTargetStudentId] = useState(
    draft?.payload.targetStudentId ?? "",
  );
  const [uploadedFileId, setUploadedFileId] = useState(
    draft?.payload.uploadedFileId ?? "",
  );
  const [uploadMetadata, setUploadMetadata] = useState<
    { name: string; byteSize: number } | undefined
  >(draft?.payload.uploadMetadata);
  const draftSave = useRef<Promise<{ id: string }> | null>(null);
  const [serverDraftId, setServerDraftId] = useState(draft?.id ?? "");
  const [draftRestored, setDraftRestored] = useState(false);
  const userId = session?.user.id ?? "demo";
  const key = `schoolconnect:draft:${userId}:${session?.activeMembershipId ?? "demo"}:${editing ? `edit:${editing.id}:${editing.revisionNumber}` : `${assignment?.assignmentId ?? "unassigned"}:${type}`}`;
  useEffect(() => {
    let active = true;
    setDraftRestored(false);
    void secureOfflineStorage
      .getItem(userId, key)
      .then((value) => {
        if (!value || !active) return;
        const local = JSON.parse(value) as ApiDraft["payload"] & {
          savedAt?: number;
        };
        if (draft && (local.savedAt ?? 0) < Date.parse(draft.updatedAt)) return;
        setTitle(local.title ?? "");
        setBody(local.body ?? "");
        if (local.dueDate) setDueDate(local.dueDate);
        if (local.examName) setExam(local.examName);
        setUrgent(local.urgent ?? false);
        setAudienceType(local.audienceType ?? "CLASS");
        setScheduledFor(local.scheduledFor ?? "");
        setTargetStudentId(local.targetStudentId ?? "");
        if (local.uploadedFileId) {
          setUploadedFileId(local.uploadedFileId);
          setUploadMetadata(local.uploadMetadata);
          setUpload("READY");
        }
      })
      .catch((failure) =>
        setPublishError(
          failure instanceof Error ? failure.message : "DRAFT_LOAD_FAILED",
        ),
      )
      .finally(() => {
        if (active) setDraftRestored(true);
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (!draftRestored || publishing || published) return;
    const timer = setTimeout(() => {
      void secureOfflineStorage
        .setItem(
          userId,
          key,
          JSON.stringify({
            title,
            body,
            dueDate,
            examName: exam,
            urgent,
            audienceType,
            scheduledFor,
            targetStudentId,
            uploadedFileId,
            uploadMetadata,
            savedAt: Date.now(),
          }),
        )
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    key,
    draftRestored,
    title,
    body,
    dueDate,
    exam,
    urgent,
    audienceType,
    scheduledFor,
    targetStudentId,
    uploadedFileId,
    uploadMetadata,
    publishing,
    published,
  ]);
  useEffect(() => {
    if (
      !session ||
      !assignment ||
      editing ||
      !draftRestored ||
      publishing ||
      published ||
      (!title.trim() && !body.trim())
    )
      return;
    const timer = setTimeout(() => {
      draftSave.current = (draftSave.current ?? Promise.resolve())
        .catch(() => undefined)
        .then(() =>
          mobileApi.saveDraft(session, {
            classId: assignment.classId,
            postType: type,
            payload: {
              title,
              body,
              subjectCode: assignment.subjectCode,
              dueDate,
              examName: exam,
              urgent,
              targetStudentId,
              audienceType,
              scheduledFor,
              uploadedFileId,
              uploadMetadata,
            },
          }),
        );
      void draftSave.current
        .then((saved) => setServerDraftId(saved.id))
        .catch(() => undefined);
    }, 1_000);
    return () => clearTimeout(timer);
  }, [
    session,
    assignment?.classId,
    editing,
    type,
    draftRestored,
    title,
    body,
    dueDate,
    exam,
    urgent,
    targetStudentId,
    audienceType,
    scheduledFor,
    uploadedFileId,
    uploadMetadata,
    publishing,
    published,
  ]);
  useEffect(() => {
    if (type === "RESULT" && session && assignment)
      void mobileApi
        .attendanceRoster(session, assignment.classId)
        .then((items) => {
          setResultStudents(items);
          setTargetStudentId((current) => current || items[0]?.id || "");
        });
  }, [type, session, assignment?.classId]);
  useEffect(() => {
    if (type !== "ANNOUNCEMENT" || !session) return;
    void mobileApi
      .context(session)
      .then((context) => {
        setScheduleEnabled(
          Boolean(context.school?.scheduledAnnouncementsEnabled),
        );
        setGradeEnabled(
          Boolean(
            context.school?.gradeWideAnnouncementsEnabled &&
              assignment?.canPublishGradeWide,
          ),
        );
        setSchoolEnabled(
          Boolean(
            context.school?.schoolWideAnnouncementsEnabled &&
              assignment?.canPublishSchoolWide,
          ),
        );
        setUrgentEnabled(
          Boolean(
            context.school?.urgentAnnouncementsEnabled &&
              assignment?.canPublishUrgent,
          ),
        );
      })
      .catch(() => undefined);
  }, [type, session, assignment?.assignmentId]);
  const attach = async () => {
    if (!session) {
      setUpload("UPLOADING");
      setTimeout(() => setUpload("READY"), 650);
      return;
    }
    setUpload("UPLOADING");
    setPublishError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) {
        setUpload("EMPTY");
        return;
      }
      const asset = picked.assets[0]!;
      const blob = await fetch(asset.uri).then((response) => response.blob());
      const bytes = await blob.arrayBuffer();
      const digest = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        bytes,
      );
      const checksumSha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const created = await mobileApi.createFileUpload(session, {
        ownerId: Crypto.randomUUID(),
        fileName: asset.name,
        mediaType: asset.mimeType ?? blob.type,
        byteSize: asset.size ?? blob.size,
        checksumSha256,
      });
      const uploaded = await fetch(created.upload.url, {
        method: "PUT",
        headers: created.upload.requiredHeaders,
        body: blob,
      });
      if (!uploaded.ok) throw new Error(`UPLOAD_HTTP_${uploaded.status}`);
      const completed = await mobileApi.completeFileUpload(
        session,
        created.uploadSessionId,
      );
      if (completed.status !== "READY") throw new Error("FILE_NOT_READY");
      setUploadedFileId(created.fileId);
      setUploadMetadata({
        name: asset.name,
        byteSize: asset.size ?? blob.size,
      });
      setUpload("READY");
    } catch (failure) {
      setUpload("FAILED");
      setPublishError(
        failure instanceof Error ? failure.message : "FILE_UPLOAD_FAILED",
      );
    }
  };
  const publish = async () => {
    const invalid =
      !title.trim() ||
      !body.trim() ||
      upload === "UPLOADING" ||
      upload === "FAILED" ||
      (type === "HOMEWORK" && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) ||
      (type === "RESULT" &&
        !editing &&
        (upload !== "READY" ||
          !privacy ||
          !targetStudentId ||
          !uploadedFileId)) ||
      Boolean(
        scheduledFor &&
          (Number.isNaN(Date.parse(scheduledFor)) ||
            Date.parse(scheduledFor) <= Date.now()),
      );
    setError(invalid);
    setPublishError("");
    if (invalid) return;
    if (!session) {
      setPublished(true);
      await secureOfflineStorage.removeItem(key);
      return;
    }
    setPublishing(true);
    try {
      if (editing) {
        const revised = await mobileApi.revisePost(session, editing.id, {
          expectedRevisionNumber: editing.revisionNumber,
          title: title.trim(),
          body: body.trim(),
          subjectCode: editing.subjectCode,
          examName: type === "RESULT" ? exam : undefined,
          dueDate: type === "HOMEWORK" ? dueDate : undefined,
          urgent: type === "ANNOUNCEMENT" ? urgent : false,
          scheduledFor:
            editing.status === "SCHEDULED" && scheduledFor
              ? new Date(scheduledFor).toISOString()
              : undefined,
          changeKind: "MATERIAL",
        }, type !== "RESULT");
        setPublishedState(
          revised.status === "QUEUED"
            ? "QUEUED"
            : revised.status === "SCHEDULED"
              ? "SCHEDULED"
              : "UPDATED",
        );
      } else {
        const assignments = await mobileApi.teachingScope(session);
        const verifiedAssignment = assignments.find(
          (item) =>
            item.assignmentId === assignment?.assignmentId &&
            (type === "RESULT"
              ? item.canPublishResults
              : type === "ANNOUNCEMENT"
                ? item.canPublishAnnouncements
                : true),
        );
        if (!verifiedAssignment)
          throw new Error("NO_ACTIVE_TEACHING_ASSIGNMENT");
        const created = await mobileApi.publish(session, {
          classId: verifiedAssignment.classId,
          postType: type,
          title: title.trim(),
          body: body.trim(),
          subjectCode: verifiedAssignment.subjectCode,
          examName: type === "RESULT" ? exam : undefined,
          dueDate: type === "HOMEWORK" ? dueDate : undefined,
          audienceType:
            type === "RESULT"
              ? "STUDENT"
              : type === "ANNOUNCEMENT"
                ? audienceType
                : "CLASS",
          scheduledFor:
            type === "ANNOUNCEMENT" && scheduledFor
              ? new Date(scheduledFor).toISOString()
              : undefined,
          targetStudentId: type === "RESULT" ? targetStudentId : undefined,
          attachments: uploadedFileId
            ? [
                {
                  fileId: uploadedFileId,
                  studentId: type === "RESULT" ? targetStudentId : undefined,
                  privacyClassification:
                    type === "RESULT" ? "STUDENT_PRIVATE" : "GENERAL",
                },
              ]
            : [],
          urgent: type === "ANNOUNCEMENT" ? urgent : false,
          idempotencyKey: createIdempotencyKey(),
        });
        setPublishedState(
          created.status === "QUEUED"
            ? "QUEUED"
            : created.status === "SCHEDULED"
              ? "SCHEDULED"
              : "PUBLISHED",
        );
      }
      await secureOfflineStorage.removeItem(key);
      const pendingDraft = await draftSave.current?.catch(() => undefined);
      const draftToDelete = pendingDraft?.id ?? serverDraftId;
      if (draftToDelete)
        await mobileApi
          .deleteDraft(session, draftToDelete)
          .catch(() => undefined);
      setPublished(true);
      onPublished();
    } catch (publishFailure) {
      setPublishError(
        publishFailure instanceof Error
          ? publishFailure.message
          : "PUBLISH_FAILED",
      );
    } finally {
      setPublishing(false);
    }
  };
  if (published)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successPage}>
          <View style={styles.successIcon}>
            <Check size={42} color="#fff" />
          </View>
          <Text style={styles.successTitle}>
            {postLabels[type]}{" "}
            {publishedState === "QUEUED"
              ? "queued offline"
              : publishedState === "SCHEDULED"
                ? "scheduled"
                : publishedState === "ARCHIVED"
                  ? "archived"
                  : editing
                    ? "updated"
                    : "published"}
          </Text>
          <Text style={styles.successBody}>
            {publishedState === "ARCHIVED"
              ? "This post is no longer visible in parent timelines. The revision history is retained."
              : publishedState === "QUEUED"
                ? "This change will sync when the connection returns. A version conflict will require review."
                : publishedState === "SCHEDULED"
                  ? "The announcement will publish at the selected time."
                  : editing
                    ? "A new revision was saved. Parents will see the Updated label."
                    : "The eligible audience was resolved and the notification event was queued."}
          </Text>
          <PrimaryButton label="Back to posts" onPress={onDone} />
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.page}>
          <Header
            title={`${editing ? "Edit" : "New"} ${postLabels[type].toLowerCase()}`}
            subtitle={assignment?.className ?? "Assigned class"}
            onBack={onBack}
          />
          <View style={styles.scopeCard}>
            <View>
              <Text style={styles.eyebrow}>AUDIENCE</Text>
              <Text style={styles.cardTitle}>
                {assignment?.className ?? "Assigned class"} ·{" "}
                {type === "RESULT"
                  ? "One selected student"
                  : (assignment?.subjectName ?? "Guardians")}
              </Text>
            </View>
            <ChevronDown size={19} color={colors.primary} />
          </View>
          {editing ? (
            <View style={styles.notice}>
              <ShieldCheck size={19} color={colors.info} />
              <Text style={styles.noticeText}>
                Saving creates revision {editing.revisionNumber + 1}. Audience
                and existing attachments stay unchanged.
              </Text>
            </View>
          ) : null}
          {type === "RESULT" && !editing ? (
            <>
              <Text style={styles.label}>Student *</Text>
              {resultStudents.map((student) => (
                <Pressable
                  key={student.id}
                  onPress={() => {
                    setTargetStudentId(student.id);
                    setUploadedFileId("");
                    setUpload("EMPTY");
                  }}
                  style={[
                    styles.checkRow,
                    targetStudentId === student.id && styles.checkRowActive,
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      targetStudentId === student.id && styles.checkboxActive,
                    ]}
                  >
                    {targetStudentId === student.id ? (
                      <Check size={15} color="#fff" />
                    ) : null}
                  </View>
                  <Text style={styles.cardTitle}>{student.displayName}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
          {type === "RESULT" ? (
            <Field
              label="Exam"
              value={exam}
              onChangeText={setExam}
              placeholder="Exam name"
              required
            />
          ) : null}
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder={
              type === "HOMEWORK"
                ? "e.g. Fractions practice"
                : `${postLabels[type]} title`
            }
            required
            error={error && !title.trim() ? "Enter a title." : undefined}
          />
          {type === "HOMEWORK" ? (
            <Field
              label="Due date"
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="YYYY-MM-DD"
              required
              error={
                error && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
                  ? "Use YYYY-MM-DD."
                  : undefined
              }
            />
          ) : null}
          <Field
            label={type === "HOMEWORK" ? "Instructions" : "Message"}
            value={body}
            onChangeText={setBody}
            placeholder="Write clear details for parents"
            multiline
            required
            error={error && !body.trim() ? "Enter details." : undefined}
          />
          {!editing ? (
            <>
              <Text style={styles.label}>
                {type === "RESULT" ? "Private result file *" : "Attachment"}
              </Text>
              <UploadTile
                state={upload}
                metadata={uploadMetadata}
                onAttach={() => {
                  void attach();
                }}
              />
              {upload !== "EMPTY" && upload !== "UPLOADING" ? <PrimaryButton label="Remove attachment" secondary onPress={() => { setUploadedFileId(""); setUploadMetadata(undefined); setUpload("EMPTY"); }} /> : null}
            </>
          ) : null}
          {type === "RESULT" && !editing ? (
            <Pressable
              onPress={() => setPrivacy((value) => !value)}
              style={[styles.checkRow, privacy && styles.checkRowActive]}
            >
              <View style={[styles.checkbox, privacy && styles.checkboxActive]}>
                {privacy ? <Check size={15} color="#fff" /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Privacy confirmed</Text>
                <Text style={styles.cardMeta}>
                  This file is mapped only to the selected student.
                </Text>
              </View>
            </Pressable>
          ) : null}
          {type === "ANNOUNCEMENT" && !editing ? (
            <>
              <Text style={styles.label}>Audience</Text>
              {(
                [
                  "CLASS",
                  ...(gradeEnabled ? ["GRADE"] : []),
                  ...(schoolEnabled ? ["SCHOOL"] : []),
                ] as Array<"CLASS" | "GRADE" | "SCHOOL">
              ).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setAudienceType(option)}
                  style={[
                    styles.checkRow,
                    audienceType === option && styles.checkRowActive,
                  ]}
                >
                  <Text style={styles.cardTitle}>
                    {option === "CLASS"
                      ? "Selected class"
                      : option === "GRADE"
                        ? "Entire grade"
                        : "Entire school"}
                  </Text>
                </Pressable>
              ))}
              {scheduleEnabled ? (
                <Field
                  label="Schedule time (YYYY-MM-DDTHH:mm, optional)"
                  value={scheduledFor}
                  onChangeText={setScheduledFor}
                  placeholder="2026-10-01T09:00"
                />
              ) : null}
            </>
          ) : null}
          {type === "ANNOUNCEMENT" && editing?.status === "SCHEDULED" ? (
            <Field
              label="Schedule time (ISO date and time)"
              value={scheduledFor}
              onChangeText={setScheduledFor}
              placeholder="YYYY-MM-DDTHH:mm"
            />
          ) : null}
          {type === "ANNOUNCEMENT" ? (
            <View style={styles.settingRow}>
              <View>
                <Text style={styles.cardTitle}>Mark urgent</Text>
                <Text style={styles.cardMeta}>
                  Requires the urgent-announcement grant
                </Text>
              </View>
              <Switch
                value={urgent}
                disabled={Boolean(session) && !urgentEnabled && !urgent}
                onValueChange={setUrgent}
                trackColor={{ true: colors.primarySoft }}
                thumbColor={urgent ? colors.primary : "#fff"}
              />
            </View>
          ) : null}
          {error &&
          type === "RESULT" &&
          !editing &&
          (upload !== "READY" || !privacy || !targetStudentId) ? (
            <Text style={styles.errorText}>
              Select a student, upload a ready private file and confirm privacy.
            </Text>
          ) : null}
          {publishError ? (
            <Text style={styles.errorText}>{publishError}</Text>
          ) : null}
          {editing && session ? (
            <>
              <PrimaryButton
                label="Load delivery report"
                secondary
                onPress={() => {
                  void mobileApi
                    .postReport(session, editing.id)
                    .then(setReport)
                    .catch((failure) =>
                      setPublishError(
                        failure instanceof Error
                          ? failure.message
                          : "REPORT_FAILED",
                      ),
                    );
                }}
              />
              {report ? (
                <Text style={styles.cardMeta}>
                  {report.recipientCount} recipients · {report.viewedCount}{" "}
                  viewed · {report.delivery.readCount} notices read
                </Text>
              ) : null}
              {editing.status !== "ARCHIVED" ? (
                <PrimaryButton
                  label="Archive post"
                  secondary
                  onPress={() => {
                    void mobileApi
                      .archivePost(session, editing.id, editing.revisionNumber)
                      .then((result) => {
                        setPublishedState(
                          result.status === "QUEUED" ? "QUEUED" : "ARCHIVED",
                        );
                        setPublished(true);
                        onPublished();
                      })
                      .catch((failure) =>
                        setPublishError(
                          failure instanceof Error
                            ? failure.message
                            : "ARCHIVE_FAILED",
                        ),
                      );
                  }}
                />
              ) : null}
            </>
          ) : null}
          <Text style={styles.draftText}>
            Draft saves automatically on this device.
          </Text>
          <PrimaryButton
            label={editing ? "Save correction" : "Publish now"}
            onPress={() => {
              void publish();
            }}
            loading={publishing}
            disabled={editing?.status === "ARCHIVED"}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UploadTile({
  state,
  onAttach,
  metadata,
}: {
  state: "EMPTY" | "UPLOADING" | "FAILED" | "READY";
  onAttach: () => void;
  metadata?: { name: string; byteSize: number };
}) {
  if (state === "EMPTY")
    return (
      <Pressable onPress={onAttach} style={styles.uploadTile}>
        <View style={styles.uploadIcon}>
          <Paperclip size={21} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Add PDF or image</Text>
          <Text style={styles.cardMeta}>
            Private · up to configured file limit
          </Text>
        </View>
        <ChevronRight size={18} color={colors.muted} />
      </Pressable>
    );
  if (state === "UPLOADING")
    return (
      <View style={styles.uploadTile}>
        <ActivityIndicator color={colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Uploading and validating…</Text>
          <Text style={styles.cardMeta}>
            Draft remains safe if connection drops
          </Text>
        </View>
      </View>
    );
  if (state === "FAILED")
    return (
      <Pressable
        onPress={onAttach}
        style={[styles.uploadTile, styles.uploadFailed]}
      >
        <RefreshCw size={21} color={colors.danger} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Upload failed</Text>
          <Text style={styles.cardMeta}>
            Tap to retry. Publishing is blocked.
          </Text>
        </View>
      </Pressable>
    );
  return (
    <View style={styles.uploadTile}>
      <FileText size={22} color={colors.primary} />
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{metadata?.name ?? 'Ready attachment'}</Text>
        <Text style={styles.cardMeta}>{metadata ? `${Math.ceil(metadata.byteSize / 1024)} KB · ` : ''}Upload validation complete</Text>
      </View>
      <Chip label="Ready" tone="success" />
    </View>
  );
}

function TeacherAttendance({
  onBack,
  assignment,
  session,
}: {
  onBack: () => void;
  assignment?: ApiTeachingAssignment;
  session: MobileSession | null;
}) {
  const [roster, setRoster] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(
    {},
  );
  const [version, setVersion] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [queued, setQueued] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  useEffect(() => {
    setRoster([]); setError(''); setVersion(0);
    if (!session || !assignment?.canRecordAttendance) { setError('Choose an active attendance assignment.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) { setError('Use YYYY-MM-DD for the attendance date.'); return; }
    let active = true;
    setLoadingRoster(true);
    void Promise.all([
      mobileApi.attendanceRoster(session, assignment.classId),
      mobileApi.attendanceVersion(session, assignment.classId, attendanceDate),
      mobileApi.attendanceCurrent(session, assignment.classId, attendanceDate),
    ])
      .then(([students, state, current]) => {
        if (!active) return;
        setRoster(students);
        setStatuses(
          Object.fromEntries(
            students.map((student) => [
              student.id,
              (current.find((item) => item.studentId === student.id)?.status ??
                "PRESENT") as AttendanceStatus,
            ]),
          ),
        );
        setVersion(state.version);
      })
      .catch((failure) => {
        if (active) setError(
          failure instanceof Error ? failure.message : "ATTENDANCE_LOAD_FAILED",
        );
      }).finally(() => { if (active) setLoadingRoster(false); });
    return () => { active = false; };
  }, [session, assignment?.classId, assignment?.canRecordAttendance, attendanceDate]);
  const submit = async () => {
    if (!session || !assignment || !roster.length || loadingRoster) return;
    setSaving(true);
    setError("");
    try {
      const result = (await mobileApi.submitAttendance(session, {
        classId: assignment.classId,
        attendanceDate,
        expectedVersion: version,
        correctionReason: version ? correctionReason : undefined,
        idempotencyKey: createIdempotencyKey(),
        rows: roster.map((student) => ({
          studentId: student.id,
          status: statuses[student.id] ?? "PRESENT",
        })),
      })) as { version?: number; status?: string };
      setQueued(result.status === "QUEUED");
      setVersion(result.version ?? version);
      setSubmitted(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "ATTENDANCE_SUBMIT_FAILED",
      );
    } finally {
      setSaving(false);
    }
  };
  if (submitted)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successPage}>
          <View style={styles.successIcon}>
            <Check size={42} color="#fff" />
          </View>
          <Text style={styles.successTitle}>
            {queued ? "Attendance queued offline" : "Attendance submitted"}
          </Text>
          <Text style={styles.successBody}>
            {queued
              ? "This batch will sync for this teacher and school when connectivity returns. Newer attendance will cause a conflict for review."
              : `The complete roster was committed atomically as version ${version}.`}
          </Text>
          <PrimaryButton label="Done" onPress={onBack} />
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Header
          title="Take attendance"
          subtitle={`${assignment?.className ?? "Assigned class"} · ${attendanceDate}`}
          onBack={onBack}
        />
        <Field
          label="Attendance date (YYYY-MM-DD)"
          value={attendanceDate}
          onChangeText={setAttendanceDate}
          placeholder="YYYY-MM-DD"
        />
        <View style={styles.notice}>
          <ShieldCheck size={19} color={colors.info} />
          <Text style={styles.noticeText}>
            All active students submit as one versioned batch. Conflicts never
            partially apply.
          </Text>
        </View>
        {roster.map((student) => (
          <View key={student.id} style={styles.rosterRow}>
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarText}>
                {student.displayName
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </Text>
            </View>
            <Text style={[styles.cardTitle, styles.flex]}>
              {student.displayName}
            </Text>
            <View style={styles.statusControl}>
              {(["PRESENT", "ABSENT", "LATE", "LEAVE"] as const).map(
                (status) => (
                  <Pressable
                    key={status}
                    accessibilityLabel={`${student.displayName} ${status}`}
                    onPress={() =>
                      setStatuses((value) => ({
                        ...value,
                        [student.id]: status,
                      }))
                    }
                    style={[
                      styles.statusOption,
                      statuses[student.id] === status &&
                        (status === "PRESENT"
                          ? styles.statusPresent
                          : styles.statusAbsent),
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        statuses[student.id] === status &&
                          styles.statusOptionTextActive,
                      ]}
                    >
                      {status === "PRESENT"
                        ? "P"
                        : status === "ABSENT"
                          ? "A"
                          : status === "LATE"
                            ? "L"
                            : "LV"}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>
          </View>
        ))}
        {version > 0 ? (
          <Field
            label="Correction reason"
            value={correctionReason}
            onChangeText={setCorrectionReason}
            placeholder="Why is attendance being corrected?"
            required
          />
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {loadingRoster ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        {!loadingRoster && !error && !roster.length ? <EmptyState icon={Users} title="No active students" body="Ask the school to enrol students in this class." /> : null}
        <PrimaryButton
          label="Submit attendance"
          onPress={() => {
            void submit();
          }}
          loading={saving}
          disabled={
            !roster.length ||
            (version > 0 && correctionReason.trim().length < 5)
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function FollowUps({
  onBack,
  assignment,
  session,
}: {
  onBack: () => void;
  assignment?: ApiTeachingAssignment;
  session: MobileSession | null;
}) {
  const [items, setItems] = useState<
    Array<{
      attendanceEventId: string;
      studentName: string;
      responseStatus: "PENDING" | "ACKNOWLEDGED";
    }>
  >([]);
  const attendanceDate = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    if (session && assignment)
      void mobileApi
        .attendanceFollowUps(session, assignment.classId, attendanceDate)
        .then(setItems)
        .catch(() => setItems([]));
  }, [session, assignment?.classId]);
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Header
          title="Absence follow-ups"
          subtitle={`${assignment?.className ?? "Assigned class"} · Today`}
          onBack={onBack}
        />
        <View style={styles.filterRow}>
          <Chip label={`All ${items.length}`} />
          <Chip
            label={`Pending ${items.filter((item) => item.responseStatus === "PENDING").length}`}
            tone="warning"
          />
          <Chip
            label={`Acknowledged ${items.filter((item) => item.responseStatus === "ACKNOWLEDGED").length}`}
            tone="success"
          />
        </View>
        {items.map((item) => (
          <FollowUp
            key={item.attendanceEventId}
            name={item.studentName}
            status={
              item.responseStatus === "PENDING" ? "Pending" : "Acknowledged"
            }
          />
        ))}
        {!items.length ? (
          <EmptyState
            icon={Users}
            title="No absence follow-ups"
            body="Absent students and guardian responses will appear after attendance is submitted."
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function FollowUp({
  name,
  status,
}: {
  name: string;
  status: "Pending" | "Acknowledged";
}) {
  return (
    <View style={styles.listRow}>
      <View style={styles.avatarSmall}>
        <Text style={styles.avatarText}>
          {name
            .split(" ")
            .map((part) => part[0])
            .join("")}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{name}</Text>
        <Text style={styles.cardMeta}>Guardian response</Text>
      </View>
      <Chip
        label={status}
        tone={status === "Pending" ? "warning" : "success"}
      />
    </View>
  );
}

function PostDetail({
  postId,
  role,
  childId,
  navigate,
  onBack,
  content = posts,
  session,
}: {
  postId: string;
  role: Role;
  childId: string;
  navigate: (route: Route) => void;
  onBack: () => void;
  content?: TimelinePost[];
  session: MobileSession | null;
}) {
  const [livePost, setLivePost] = useState<TimelinePost | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [failure, setFailure] = useState("");
  const [offlineFailure, setOfflineFailure] = useState(false);
  const [viewRecorded, setViewRecorded] = useState(!session);
  useEffect(() => {
    if (!session || role !== "PARENT") return;
    let active = true;
    void mobileApi
      .postDetail(session, postId, childId)
      .then(async (item) => {
        if (!active) return;
        setLivePost(timelinePost(item, childId));
        setLoading(false);
        try {
          await mobileApi.markPostViewed(session, postId, childId);
          if (active) setViewRecorded(true);
        } catch {
          /* Viewing remains separate from absence acknowledgement. */
        }
      })
      .catch((error) => {
        if (active) {
          setFailure(
            error instanceof Error ? error.message : "POST_LOAD_FAILED",
          );
          setOfflineFailure(isNetworkError(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [session, postId, childId, role]);
  const cachedPost = content.find(
    (item) => item.id === postId && item.childId === childId,
  );
  const post =
    livePost ??
    (!session
      ? cachedPost
      : offlineFailure && cachedPost?.type !== "RESULT"
        ? cachedPost
        : undefined);
  if (loading)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.page}>
          <Header title="Loading update" onBack={onBack} />
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  if (!post)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.page}>
          <Header title="Content unavailable" onBack={onBack} />
          <EmptyState
            icon={ShieldCheck}
            title="You can’t open this item"
            body={
              failure ||
              "The resource is not available in the active child and school context."
            }
          />
        </View>
      </SafeAreaView>
    );
  const Icon = postIcons[post.type];
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Header
          title={postLabels[post.type]}
          subtitle={post.subject ?? "School update"}
          onBack={onBack}
        />
        <View style={styles.detailIcon}>
          <Icon size={28} color={colors.primary} />
        </View>
        <View style={styles.inline}>
          {post.updated ? <Chip label="Updated" tone="info" /> : null}
          <Text style={styles.cardMeta}>{post.timestamp}</Text>
        </View>
        <Text style={styles.detailTitle}>{post.title}</Text>
        <Text style={styles.detailMeta}>
          {post.author}
          {post.dueDate ? ` · Due ${post.dueDate}` : ""}
        </Text>
        <Text style={styles.detailBody}>{post.body}</Text>
        {post.attachment && !offlineFailure ? (
          <Pressable
            onPress={() =>
              post.attachment?.state === "READY" &&
              navigate({
                name: "file-preview",
                fileName: post.attachment.name,
                fileId: post.attachment.fileId,
                studentId: childId,
              })
            }
            style={styles.uploadTile}
          >
            <FileText size={24} color={colors.primary} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{post.attachment.name}</Text>
              <Text style={styles.cardMeta}>
                {post.attachment.size} · Private attachment
              </Text>
            </View>
            <ChevronRight size={19} color={colors.muted} />
          </Pressable>
        ) : null}
        <View style={styles.notice}>
          <Check size={18} color={colors.success} />
          <Text style={styles.noticeText}>
            {viewRecorded
              ? "View recorded."
              : "Read receipt not recorded; reconnect to sync."}{" "}
            Viewing does not acknowledge attendance.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AbsenceScreen({
  onBack,
  session,
  eventId,
}: {
  onBack: () => void;
  session: MobileSession | null;
  eventId: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [leave, setLeave] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [queued, setQueued] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(session));
  const [recordDate, setRecordDate] = useState('');
  const [recordStatus, setRecordStatus] = useState('ABSENT');
  const [leaveStatus, setLeaveStatus] = useState('');
  const [available, setAvailable] = useState(!session);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void mobileApi.attendanceEvent(session, eventId).then(async (event) => {
      const history = await mobileApi.attendanceHistory(session, event.studentId);
      if (!active) return;
      setRecordDate(new Date(event.attendanceDate).toLocaleDateString());
      const current = history.find((item) => item.attendanceDate.slice(0,10) === event.attendanceDate.slice(0,10));
      setRecordStatus(current?.attendanceStatus ?? event.attendanceStatus);
      if (current?.id !== eventId) { setError('This alert was replaced by a newer attendance record.'); return; }
      setAvailable(current.attendanceStatus === 'ABSENT');
      if (current.responseType) { setSubmitted(true); setAcknowledged(true); setLeave(current.responseType === 'LEAVE_SUBMITTED'); setReason(current.responseReason ?? ''); }
      setLeaveStatus(current.leaveStatus ?? '');
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : 'ATTENDANCE_LOAD_FAILED'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, eventId]);
  const submit = async () => {
    if (!available || loading || submitted) return;
    if (!session) {
      setSubmitted(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = (await mobileApi.acknowledgeAbsence(session, eventId, {
        idempotencyKey: createIdempotencyKey(),
        reason: reason.trim() || undefined,
        leaveNote: leave,
      })) as { status?: string };
      setQueued(response.status === "QUEUED");
      setSubmitted(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "ABSENCE_RESPONSE_FAILED",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Header
          title="Absence details"
          subtitle={`Authorized attendance record${recordDate ? ` · ${recordDate}` : ''}`}
          onBack={onBack}
        />
        <View style={styles.absenceHero}>
          <CircleAlert size={29} color={colors.warning} />
          <View style={styles.flex}>
            <Text style={styles.detailTitle}>{recordStatus === 'ABSENT' ? 'Marked absent' : `Marked ${recordStatus.toLowerCase()}`}</Text>
            <Text style={styles.cardMeta}>Official attendance record</Text>
          </View>
          <Chip
            label={
              submitted
                ? queued
                  ? "Queued offline"
                  : leave
                    ? "Leave submitted"
                    : "Acknowledged"
                : loading ? 'Loading' : available ? "Pending" : 'No response required'
            }
            tone={submitted ? "success" : "warning"}
          />
        </View>
        <View style={styles.notice}>
          <ShieldCheck size={19} color={colors.info} />
          <Text style={styles.noticeText}>
            Acknowledgement confirms you saw this alert. It does not alter
            official attendance.
          </Text>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {submitted ? (
          <View style={styles.responseCard}>
            <View style={styles.successMini}>
              <Check size={18} color="#fff" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>
                {queued
                  ? "Response queued offline"
                  : leave
                    ? "Leave note submitted"
                    : "Absence acknowledged"}
              </Text>
              <Text style={styles.cardMeta}>
                {queued
                  ? "Will sync for this guardian when connected"
                  : "Recorded with guardian identity and timestamp"}
              </Text>
              {reason ? (
                <Text style={styles.cardBody}>Reason: {reason}</Text>
              ) : null}
              {leaveStatus ? <Text style={styles.cardBody}>School review: {leaveStatus.toLowerCase()}</Text> : null}
            </View>
          </View>
        ) : !loading && available ? (
          <>
            <Pressable
              onPress={() => setAcknowledged((value) => !value)}
              style={[styles.checkRow, acknowledged && styles.checkRowActive]}
            >
              <View
                style={[styles.checkbox, acknowledged && styles.checkboxActive]}
              >
                {acknowledged ? <Check size={15} color="#fff" /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>
                  I acknowledge this absence alert
                </Text>
                <Text style={styles.cardMeta}>Required explicit action</Text>
              </View>
            </Pressable>
            <Field
              label="Optional reason"
              value={reason}
              onChangeText={setReason}
              placeholder="Tell the school why the student was absent"
              multiline
            />
            <Pressable
              onPress={() => setLeave((value) => !value)}
              style={[styles.checkRow, leave && styles.checkRowActive]}
            >
              <View style={[styles.checkbox, leave && styles.checkboxActive]}>
                {leave ? <Check size={15} color="#fff" /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Submit as a leave note</Text>
                <Text style={styles.cardMeta}>
                  School review is separate from official attendance.
                </Text>
              </View>
            </Pressable>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <PrimaryButton
              label={
                leave
                  ? "Acknowledge and submit leave note"
                  : "Acknowledge absence"
              }
              disabled={!acknowledged}
              loading={saving}
              onPress={() => {
                void submit();
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function FilePreview({
  fileName,
  fileId,
  studentId,
  session,
  onBack,
}: {
  fileName: string;
  fileId?: string;
  studentId?: string;
  session: MobileSession | null;
  onBack: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    if (!session || !fileId) return;
    setOpening(true);
    setError("");
    try {
      const access = await mobileApi.fileAccess(session, fileId, studentId);
      await Linking.openURL(access.url);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "FILE_ACCESS_FAILED",
      );
    } finally {
      setOpening(false);
    }
  };
  return (
    <SafeAreaView style={styles.filePage}>
      <Header
        title="Private file"
        subtitle="Authorized preview"
        onBack={onBack}
      />
      <View style={styles.fileCanvas}>
        <FileText size={68} color={colors.primary} />
        <Text style={styles.fileTitle}>{fileName}</Text>
        <Text style={styles.fileMeta}>
          Access is checked against the active school, role and child. The link
          expires quickly and is not stored in the app.
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
      <View style={styles.fileActions}>
        {fileId ? (
          <PrimaryButton
            label="Open secure file"
            loading={opening}
            onPress={() => {
              void open();
            }}
          />
        ) : null}
        <PrimaryButton label="Close preview" secondary onPress={onBack} />
      </View>
    </SafeAreaView>
  );
}

function BottomNav({
  role,
  active,
  onChange,
}: {
  role: Role;
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: "home", label: "Home", icon: Home },
    { key: "posts", label: "Posts", icon: BookOpen },
    { key: "attendance", label: "Attendance", icon: CalendarCheck },
    { key: "notifications", label: "Alerts", icon: Bell },
    {
      key: "profile",
      label: role === "TEACHER" ? "Profile" : "Account",
      icon: UserRound,
    },
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map(({ key, label, icon: Icon }) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === key }}
          onPress={() => onChange(key)}
          style={styles.navItem}
        >
          <Icon
            size={21}
            color={active === key ? colors.primary : colors.muted}
            strokeWidth={active === key ? 2.6 : 2}
          />
          <Text
            style={[styles.navLabel, active === key && styles.navLabelActive]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MainApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRoleState] = useState<Role>("PARENT");
  const [tab, setTab] = useState<TabKey>("home");
  const [childId, setChildId] = useState(children[0]!.id);
  const [route, setRoute] = useState<Route>(null);
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState<MobileSession | null>(null);
  const [liveChildren, setLiveChildren] = useState<Child[]>([]);
  const [livePosts, setLivePosts] = useState<TimelinePost[]>([]);
  const [teacherPosts, setTeacherPosts] = useState<ApiTeacherPost[]>([]);
  const [teacherDrafts, setTeacherDrafts] = useState<ApiDraft[]>([]);
  const [teachingScope, setTeachingScope] = useState<ApiTeachingAssignment[]>(
    [],
  );
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const selectedAssignment =
    teachingScope.find((item) => item.assignmentId === selectedAssignmentId) ??
    teachingScope[0];
  const [attendanceHistory, setAttendanceHistory] = useState<
    Array<{
      id: string;
      attendanceDate: string;
      attendanceStatus: string;
      responseType?: string | null;
      leaveStatus?: string | null;
    }>
  >([]);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [restoring, setRestoring] = useState(!demoMode);

  useEffect(() => {
    if (!session || role !== "PARENT") return;
    const open = (url: string | null) => {
      const next = url ? routeFromDeepLink(url) : null;
      if (!next) return;
      if (next.name === "post-detail" && next.studentId)
        setChildId(next.studentId);
      setRoute(next);
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", ({ url }) =>
      open(url),
    );
    return () => subscription.remove();
  }, [session?.activeMembershipId, role]);

  useEffect(() => {
    if (demoMode) return;
    void loadSession()
      .then(async (stored) => {
        if (!stored) return;
        try {
          const context = await mobileApi.context(stored);
          const refreshed = {
            ...stored,
            memberships: context.memberships,
            activeMembershipId:
              (context.principal as { membershipId?: string }).membershipId ??
              stored.activeMembershipId,
          };
          await saveSession(refreshed);
          setSession(refreshed);
          setRoleState(context.principal.role);
          setSignedIn(true);
        } catch (error) {
          if (isNetworkError(error)) {
            const membership =
              stored.memberships.find(
                (item) => item.id === stored.activeMembershipId,
              ) ?? stored.memberships[0];
            if (membership) {
              setSession(stored);
              setRoleState(membership.role);
              setSignedIn(true);
              setOffline(true);
            }
          } else await clearSession();
        }
      })
      .finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    if (!session || role !== "PARENT") return;
    void mobileApi
      .children(session, (online) => setOffline(!online))
      .then((items) => {
        const mapped = items.map((item) => ({
          id: item.id,
          name: item.displayName,
          school: item.schoolName,
          className: item.className,
          avatar: item.displayName
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
        }));
        setLiveChildren(mapped);
        if (mapped[0] && !mapped.some((item) => item.id === childId))
          setChildId(mapped[0].id);
      })
      .catch((error) => {
        if (isNetworkError(error)) setOffline(true);
      });
  }, [session, role, childId]);

  useEffect(() => {
    if (
      !session ||
      role !== "PARENT" ||
      !childId ||
      !liveChildren.some((item) => item.id === childId)
    )
      return;
    let active = true;
    const refresh = () => {
      void mobileApi
        .timeline(session, childId, (online) => setOffline(!online))
        .then((items) => {
          if (!active) return;
          setLivePosts(items.map((item) => timelinePost(item, childId)));
        })
        .catch((error) => {
          if (isNetworkError(error)) setOffline(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, role, childId, liveChildren]);

  useEffect(() => {
    if (
      !session ||
      role !== "PARENT" ||
      !childId ||
      !liveChildren.some((item) => item.id === childId)
    ) {
      setAttendanceHistory([]);
      return;
    }
    void mobileApi
      .attendanceHistory(session, childId)
      .then(setAttendanceHistory)
      .catch(() => setAttendanceHistory([]));
  }, [session, role, childId, liveChildren]);

  useEffect(() => {
    if (!session || role !== "TEACHER") return;
    let active = true;
    const refresh = () => {
      void Promise.all([
        mobileApi.teacherPosts(session),
        mobileApi.drafts(session),
      ])
        .then(([items, drafts]) => {
          if (active) {
            setTeacherPosts(items);
            setTeacherDrafts(drafts);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    void mobileApi
      .teachingScope(session)
      .then((items) => {
        if (active) setTeachingScope(items);
      })
      .catch(() => undefined);
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, role]);

  useEffect(() => {
    if (!session) return;
    const sync = () => {
      void mobileApi.syncOfflineQueue(session).catch(() => undefined);
    };
    sync();
    const timer = setInterval(sync, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session, role]);

  const refreshTeacherPosts = () => {
    if (!session) return;
    void Promise.all([
      mobileApi.teacherPosts(session),
      mobileApi.drafts(session),
    ])
      .then(([items, drafts]) => {
        setTeacherPosts(items);
        setTeacherDrafts(drafts);
      })
      .catch(() => undefined);
  };

  const setRole = async (next: Role) => {
    if (next === role || switchingRole) return;
    setRoleError("");
    if (session) {
      const membership = session.memberships.find((item) => item.role === next);
      if (!membership) {
        setRoleError("This account does not have that role.");
        return;
      }
      setSwitchingRole(true);
      try {
        const switched = await mobileApi.switchRole(session, membership.id);
        const nextSession = {
          ...session,
          accessToken: switched.accessToken,
          expiresInSeconds: switched.expiresInSeconds,
          activeMembershipId: switched.activeMembership.id,
        };
        await saveSession(nextSession);
        setSession(nextSession);
      } catch (switchFailure) {
        setRoleError(
          switchFailure instanceof Error
            ? switchFailure.message
            : "ROLE_SWITCH_FAILED",
        );
        setSwitchingRole(false);
        return;
      }
      setSwitchingRole(false);
    }
    setRoleState(next);
    setTab("home");
    setRoute(null);
    setChildId(session ? (liveChildren[0]?.id ?? "") : children[0]!.id);
  };
  const logout = () => {
    if (session)
      void mobileApi
        .logout(session)
        .catch(() => undefined)
        .finally(() => {
          void clearSession();
        });
    else void clearSession();
    setSession(null);
    setLiveChildren([]);
    setLivePosts([]);
    setTeacherPosts([]);
    setTeachingScope([]);
    setAttendanceHistory([]);
    setTab("home");
    setRoute(null);
    setSignedIn(false);
  };
  if (restoring)
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  if (!signedIn)
    return (
      <LoginScreen
        onSignedIn={(resolvedRole, authenticatedSession) => {
          setSession(authenticatedSession ?? null);
          setRoleState(resolvedRole);
          setSignedIn(true);
        }}
      />
    );
  if (session && role === "PLATFORM_OWNER")
    return <PlatformOwnerDashboard session={session} logout={logout} />;
  if (session && role === "SCHOOL_ADMIN")
    return <SchoolAdminDashboard session={session} logout={logout} />;
  if (route?.name === "compose") {
    const draft = teacherDrafts.find((item) => item.id === route.draftId);
    const assignment = draft
      ? resolveAssignment(
          teachingScope,
          draft.classId,
          draft.payload.subjectCode,
        )
      : selectedAssignment;
    return (
      <ComposeScreen
        key={draft?.id ?? `${assignment?.assignmentId}:${route.type}`}
        type={route.type}
        draft={draft}
        assignment={assignment}
        session={session}
        onPublished={refreshTeacherPosts}
        onBack={() => {
          refreshTeacherPosts();
          setRoute(null);
        }}
        onDone={() => {
          setRoute(null);
          setTab("posts");
        }}
      />
    );
  }
  if (route?.name === "edit-post") {
    const editing = teacherPosts.find((post) => post.id === route.postId);
    if (!editing)
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.page}>
            <Header title="Content unavailable" onBack={() => setRoute(null)} />
            <EmptyState
              icon={ShieldCheck}
              title="This post cannot be edited"
              body="Refresh the teacher post list and try again."
            />
          </View>
        </SafeAreaView>
      );
    return (
      <ComposeScreen
        key={`${editing.id}:${editing.revisionNumber}`}
        type={editing.postType}
        editing={editing}
        assignment={resolveAssignment(
          teachingScope,
          editing.classId ?? "",
          editing.subjectCode,
        )}
        session={session}
        onPublished={refreshTeacherPosts}
        onBack={() => setRoute(null)}
        onDone={() => {
          setRoute(null);
          setTab("posts");
        }}
      />
    );
  }
  if (route?.name === "teacher-attendance")
    return (
      <TeacherAttendance
        assignment={selectedAssignment}
        session={session}
        onBack={() => setRoute(null)}
      />
    );
  if (route?.name === "follow-ups")
    return (
      <FollowUps
        assignment={selectedAssignment}
        session={session}
        onBack={() => setRoute(null)}
      />
    );
  if (route?.name === "post-detail")
    return (
      <PostDetail
        key={`${route.postId}:${route.studentId ?? childId}`}
        session={session}
        postId={route.postId}
        role={role}
        childId={route.studentId ?? childId}
        navigate={setRoute}
        onBack={() => setRoute(null)}
        content={session && role === "PARENT" ? livePosts : posts}
      />
    );
  if (route?.name === "absence")
    return (
      <AbsenceScreen
        key={route.eventId}
        session={session}
        eventId={route.eventId}
        onBack={() => {
          if (session && role === "PARENT")
            void mobileApi
              .attendanceHistory(session, childId)
              .then(setAttendanceHistory);
          setRoute(null);
        }}
      />
    );
  if (route?.name === "file-preview")
    return (
      <FilePreview
        fileName={route.fileName}
        fileId={route.fileId}
        studentId={route.studentId}
        session={session}
        onBack={() => setRoute(null)}
      />
    );
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {role === "TEACHER" &&
      teachingScope.length > 1 &&
      ["home", "posts", "attendance"].includes(tab) ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <Text style={styles.eyebrow}>SELECT CLASS AND SUBJECT</Text>
          <ScrollView horizontal contentContainerStyle={styles.childSwitchRow}>
            {teachingScope.map((item) => (
              <Pressable
                key={item.assignmentId}
                accessibilityRole="button"
                accessibilityLabel={`${item.className}, ${item.subjectName}`}
                accessibilityState={{
                  selected:
                    item.assignmentId === selectedAssignment?.assignmentId,
                }}
                onPress={() => setSelectedAssignmentId(item.assignmentId)}
                style={[
                  styles.childPill,
                  item.assignmentId === selectedAssignment?.assignmentId &&
                    styles.childPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.childName,
                    item.assignmentId === selectedAssignment?.assignmentId &&
                      styles.childNameActive,
                  ]}
                >
                  {item.className} · {item.subjectName}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.appBody}>
        {tab === "home" ? (
          role === "TEACHER" ? (
            <TeacherHome
              session={session}
              onNotifications={() => setTab("notifications")}
              navigate={setRoute}
              publishedPosts={session ? teacherPosts : undefined}
              teacherName={session?.user.displayName}
              assignment={selectedAssignment}
            />
          ) : (
            <ParentHome
              parentName={session?.user.displayName}
              onNotifications={() => setTab("notifications")}
              childId={childId}
              setChildId={setChildId}
              navigate={setRoute}
              offline={offline}
              availableChildren={session ? liveChildren : children}
              feed={session ? livePosts : undefined}
              pendingAbsenceId={
                attendanceHistory.find(
                  (item) =>
                    item.attendanceStatus === "ABSENT" && !item.responseType,
                )?.id
              }
            />
          )
        ) : null}
        {tab === "posts" ? (
          <PostsScreen
            drafts={session && role === "TEACHER" ? teacherDrafts : undefined}
            role={role}
            childId={childId}
            navigate={setRoute}
            feed={session && role === "PARENT" ? livePosts : undefined}
            publishedPosts={
              session && role === "TEACHER" ? teacherPosts : undefined
            }
            assignment={selectedAssignment}
          />
        ) : null}
        {tab === "attendance" ? (
          <AttendanceTab
            role={role}
            navigate={setRoute}
            className={selectedAssignment?.className}
            history={attendanceHistory}
          />
        ) : null}
        {tab === "notifications" ? (
          <NotificationsScreen
            role={role}
            navigate={(next) => {
              if (next?.name === "post-detail" && next.studentId)
                setChildId(next.studentId);
              setRoute(next);
            }}
            session={session}
          />
        ) : null}
        {tab === "profile" ? (
          <ProfileScreen
            role={role}
            setRole={(next) => {
              void setRole(next);
            }}
            availableRoles={
              session
                ? Array.from(
                    new Set(
                      session.memberships.map((membership) => membership.role),
                    ),
                  )
                : ["TEACHER", "PARENT"]
            }
            displayName={
              session?.user.displayName ??
              (role === "TEACHER" ? "Ms. Priya" : "Ahmed Ali")
            }
            switchingRole={switchingRole}
            roleError={roleError}
            offline={offline}
            setOffline={setOffline}
            logout={logout}
            session={session}
          />
        ) : null}
      </View>
      <BottomNav role={role} active={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular: PoppinsRegular,
    Poppins_500Medium: PoppinsMedium,
    Poppins_600SemiBold: PoppinsSemiBold,
    Poppins_700Bold: PoppinsBold,
  });
  if (!fontsLoaded)
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  appBody: { flex: 1, backgroundColor: colors.surface },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  page: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
    backgroundColor: colors.surface,
    minHeight: "100%",
  },
  header: { paddingTop: 12, paddingBottom: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", minHeight: 52 },
  headerText: { flex: 1, marginHorizontal: 12 },
  headerTitle: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 22,
    color: colors.ink,
  },
  headerSubtitle: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  iconPlaceholder: { width: 44 },
  login: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  loginHero: { alignItems: "center", marginBottom: 28 },
  loginLogo: {
    width: 82,
    height: 82,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginBottom: 18,
  },
  loginTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 26,
    textAlign: "center",
    color: colors.ink,
  },
  loginBody: {
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    color: colors.muted,
    marginTop: 8,
    maxWidth: 320,
  },
  loginCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    minHeight: 54,
    borderRadius: radius.button,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
  },
  buttonPressed: {
    backgroundColor: colors.primaryPressed,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 15,
    color: "#fff",
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  buttonSecondaryText: { color: colors.primary },
  fieldWrap: { gap: 7 },
  label: { fontFamily: "Poppins_500Medium", fontSize: 13, color: colors.ink },
  required: { color: colors.danger },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: "Poppins_400Regular",
    fontSize: 15,
    color: colors.ink,
    backgroundColor: "#FBFBFD",
  },
  textarea: { minHeight: 126, paddingTop: 14, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  errorText: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    color: colors.danger,
  },
  helper: {
    fontFamily: "Poppins_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
  link: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    color: colors.primary,
    textAlign: "center",
  },
  linkInline: {
    fontFamily: "Poppins_500Medium",
    fontSize: 12,
    color: colors.primary,
  },
  securityNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingTop: 4,
  },
  securityText: {
    flex: 1,
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },
  offline: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
  },
  offlineText: {
    fontFamily: "Poppins_500Medium",
    fontSize: 11,
    color: colors.warning,
  },
  sectionTitle: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 17,
    color: colors.ink,
    marginTop: 4,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  scopeCard: {
    minHeight: 83,
    borderRadius: radius.card,
    padding: 16,
    backgroundColor: colors.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scopeTitle: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 17,
    color: colors.ink,
  },
  scopeMeta: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  quickAction: {
    width: "47.9%",
    minHeight: 98,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    justifyContent: "space-between",
    backgroundColor: colors.surface,
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    color: colors.ink,
  },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  listRow: {
    minHeight: 72,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    color: colors.ink,
  },
  cardTitleLarge: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 15,
    color: colors.ink,
  },
  cardBody: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
  cardMeta: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },
  cardEyebrow: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.primary,
  },
  cardTime: {
    fontFamily: "Poppins_400Regular",
    fontSize: 10,
    color: colors.muted,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  actionCard: {
    minHeight: 88,
    padding: 14,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontFamily: "Poppins_500Medium", fontSize: 9 },
  chipPurple: { backgroundColor: colors.primarySoft, color: colors.primary },
  chipWarning: { backgroundColor: colors.warningSoft, color: colors.warning },
  chipSuccess: { backgroundColor: colors.successSoft, color: colors.success },
  chipDanger: { backgroundColor: colors.dangerSoft, color: colors.danger },
  chipInfo: { backgroundColor: colors.infoSoft, color: colors.info },
  childSwitchRow: { gap: 10, paddingRight: 20 },
  childPill: {
    minWidth: 176,
    minHeight: 62,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: colors.surface,
  },
  childPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  avatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  avatarSmallActive: { backgroundColor: "#fff" },
  avatarText: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 11,
    color: colors.primary,
  },
  avatarTextActive: { color: colors.primary },
  childName: {
    fontFamily: "Poppins_500Medium",
    fontSize: 12,
    color: colors.ink,
  },
  childNameActive: { color: "#fff" },
  childClass: {
    fontFamily: "Poppins_400Regular",
    fontSize: 10,
    color: colors.muted,
  },
  childClassActive: { color: "#E9D8FF" },
  childSummary: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  avatarLarge: {
    width: 58,
    height: 58,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLargeText: {
    fontFamily: "Poppins_700Bold",
    fontSize: 16,
    color: colors.primary,
  },
  timelineCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    gap: 10,
    backgroundColor: colors.surface,
  },
  timelineHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  timelineFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 9,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  notificationRow: {
    minHeight: 78,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  notificationUnread: { backgroundColor: "#FAF7FF", borderRadius: 14 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 70,
    paddingHorizontal: 28,
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  emptyTitle: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 17,
    color: colors.ink,
  },
  emptyBody: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    lineHeight: 20,
    color: colors.muted,
    textAlign: "center",
    marginTop: 7,
  },
  attendanceHero: {
    alignSelf: "center",
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 16,
    borderColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
  },
  attendancePercent: {
    fontFamily: "Poppins_700Bold",
    fontSize: 30,
    color: colors.primary,
  },
  statsRow: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 12,
    gap: 6,
    alignItems: "center",
  },
  statValue: { fontFamily: "Poppins_700Bold", fontSize: 19, color: colors.ink },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 8,
  },
  roleSwitch: {
    flexDirection: "row",
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 4,
  },
  roleChoice: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  roleChoiceActive: { backgroundColor: colors.primary },
  roleText: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    color: colors.muted,
  },
  roleTextActive: { color: "#fff" },
  settingRow: {
    minHeight: 68,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  uploadTile: {
    minHeight: 74,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FBFBFD",
  },
  uploadIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadFailed: { backgroundColor: colors.dangerSoft, borderColor: "#F6BFC6" },
  progress: {
    height: 5,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginVertical: 5,
  },
  progressFill: {
    width: "64%",
    height: 5,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  checkRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 13,
  },
  checkRowActive: { borderColor: colors.primary, backgroundColor: "#FAF7FF" },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  draftText: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
  },
  successPage: {
    flex: 1,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: colors.surface,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 24,
    color: colors.ink,
    textAlign: "center",
  },
  successBody: {
    fontFamily: "Poppins_400Regular",
    fontSize: 13,
    lineHeight: 22,
    color: colors.muted,
    textAlign: "center",
    marginBottom: 14,
    maxWidth: 320,
  },
  notice: {
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: colors.infoSoft,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  noticeText: {
    flex: 1,
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    lineHeight: 18,
    color: colors.ink,
  },
  rosterRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusControl: { flexDirection: "row", gap: 5 },
  statusOption: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  statusPresent: { backgroundColor: colors.success },
  statusAbsent: { backgroundColor: colors.danger },
  statusOptionText: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 11,
    color: colors.muted,
  },
  statusOptionTextActive: { color: "#fff" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  successCard: {
    borderRadius: radius.card,
    padding: 16,
    gap: 8,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: "#BDE7D2",
  },
  invitationCode: {
    fontFamily: "Poppins_700Bold",
    fontSize: 20,
    letterSpacing: 1,
    color: colors.primary,
  },
  successText: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    color: colors.success,
  },
  detailIcon: {
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  detailTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 23,
    lineHeight: 31,
    color: colors.ink,
  },
  detailMeta: {
    fontFamily: "Poppins_500Medium",
    fontSize: 12,
    color: colors.primary,
  },
  detailBody: {
    fontFamily: "Poppins_400Regular",
    fontSize: 15,
    lineHeight: 25,
    color: colors.ink,
  },
  absenceHero: {
    minHeight: 105,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.card,
    padding: 15,
  },
  responseCard: {
    flexDirection: "row",
    gap: 12,
    padding: 15,
    borderRadius: radius.card,
    backgroundColor: colors.successSoft,
  },
  successMini: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.success,
  },
  filePage: { flex: 1, paddingHorizontal: 20, backgroundColor: "#F1EFF5" },
  fileCanvas: {
    flex: 1,
    marginVertical: 12,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  fileTitle: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 18,
    color: colors.ink,
    textAlign: "center",
    marginTop: 18,
  },
  fileMeta: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    lineHeight: 20,
    color: colors.muted,
    textAlign: "center",
    marginTop: 8,
  },
  fileActions: { paddingBottom: 20 },
  bottomNav: {
    height: 82,
    paddingTop: 9,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    backgroundColor: colors.surface,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  navLabel: {
    fontFamily: "Poppins_400Regular",
    fontSize: 9,
    color: colors.muted,
  },
  navLabelActive: { fontFamily: "Poppins_600SemiBold", color: colors.primary },
});
