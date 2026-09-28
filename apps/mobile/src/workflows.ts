import type { ApiTeachingAssignment, ApiTimelinePost } from './api';
import type { Route, TimelinePost } from './domain';

export function resolveAssignment(scope: ApiTeachingAssignment[], classId: string, subjectCode?: string) {
  return scope.find((item) => item.classId === classId && (!subjectCode || item.subjectCode === subjectCode));
}

export function timelinePost(item: ApiTimelinePost, childId: string): TimelinePost {
  return {
    id: item.id, childId, type: item.postType, title: item.title, body: item.body,
    subject: item.subjectCode ?? item.examName,
    dueDate: item.dueDate ? new Date(item.dueDate).toLocaleDateString() : undefined,
    author: 'SchoolConnect', timestamp: new Date(item.publishedAt).toLocaleString(),
    unread: false, updated: item.status === 'UPDATED',
    attachment: item.attachments[0] ? { fileId: item.attachments[0].fileId, name: 'Private attachment', size: 'Authorized file', state: 'READY' } : undefined,
  };
}

export function routeFromDeepLink(value: string): Route {
  try {
    const url = new URL(value);
    if (url.protocol !== 'schoolconnect:') return null;
    const id = url.pathname.replace(/^\//, '');
    if (!/^[a-f\d-]{36}$/i.test(id)) return null;
    if (url.hostname === 'posts') return { name: 'post-detail', postId: id, studentId: url.searchParams.get('studentId') ?? undefined };
    if (url.hostname === 'attendance') return { name: 'absence', eventId: id };
    return null;
  } catch { return null; }
}
