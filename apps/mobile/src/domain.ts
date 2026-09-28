export type Role = 'PLATFORM_OWNER' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
export type TabKey = 'home' | 'posts' | 'attendance' | 'notifications' | 'profile';
export type PostType = 'HOMEWORK' | 'RESULT' | 'ANNOUNCEMENT';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
export type Route =
  | { name: 'compose'; type: PostType; draftId?: string }
  | { name: 'edit-post'; postId: string }
  | { name: 'teacher-attendance' }
  | { name: 'follow-ups' }
  | { name: 'post-detail'; postId: string; studentId?: string }
  | { name: 'absence'; eventId: string }
  | { name: 'file-preview'; fileName: string; fileId?: string; studentId?: string }
  | null;

export type Child = { id: string; name: string; school: string; className: string; avatar: string };
export type TimelinePost = {
  id: string;
  childId: string;
  type: PostType;
  title: string;
  body: string;
  subject?: string;
  dueDate?: string;
  author: string;
  timestamp: string;
  unread: boolean;
  updated?: boolean;
  attachment?: { fileId?: string; name: string; size: string; state: 'READY' | 'UNAVAILABLE' };
};

export const children: Child[] = [
  { id: 'child-jenny', name: 'Jenny Wilson', school: 'Thomas Jefferson High School', className: 'Grade 5A', avatar: 'JW' },
  { id: 'child-leslie', name: 'Leslie Alexander', school: 'Carnegie Vanguard High School', className: 'Grade 2B', avatar: 'LA' },
];

export const posts: TimelinePost[] = [
  { id: 'post-homework', childId: 'child-jenny', type: 'HOMEWORK', title: 'Fractions practice', body: 'Solve questions 1–10 from chapter 7. Show your working in the notebook.', subject: 'Mathematics', dueDate: 'Tomorrow', author: 'Ms. Priya', timestamp: '10:30 AM', unread: true, attachment: { name: 'Chapter 7 questions.pdf', size: '60.5 KB', state: 'READY' } },
  { id: 'post-result', childId: 'child-jenny', type: 'RESULT', title: 'Midyear results', body: 'Your child’s private result is ready to view.', subject: 'All subjects', author: 'School Office', timestamp: 'Yesterday', unread: true, attachment: { name: 'Jenny_Wilson_Result.pdf', size: '240 KB', state: 'READY' } },
  { id: 'post-announcement', childId: 'child-jenny', type: 'ANNOUNCEMENT', title: 'Holiday announcement', body: 'School will remain closed on Thursday for the regional holiday.', author: 'Thomas Jefferson High School', timestamp: '3 days ago', unread: false, updated: true },
  { id: 'post-leslie', childId: 'child-leslie', type: 'HOMEWORK', title: 'Reading practice', body: 'Read pages 12–18 with a guardian.', subject: 'English', dueDate: 'Friday', author: 'Mr. Thomas', timestamp: '9:15 AM', unread: true },
];

export function scopedTimeline(childId: string) {
  return posts.filter((post) => post.childId === childId);
}

export function canOpenPost(role: Role, childId: string | undefined, post: TimelinePost) {
  return role === 'TEACHER' || childId === post.childId;
}
