import { secureOfflineStorage } from './secureOfflineStorage';

export type QueuedMutation = {
  id: string;
  userId: string;
  membershipId: string;
  schoolId: string | null;
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  state: 'PENDING' | 'CONFLICT';
  error?: string;
};

const key = (userId: string) => `schoolconnect:offline:${userId}`;
const cacheKey = (userId: string, schoolId: string, studentId: string) => `schoolconnect:cache:${userId}:${schoolId}:${studentId}`;
const childrenKey = (userId: string, schoolId: string) => `schoolconnect:cache:${userId}:${schoolId}:children`;
const scopedKey = (userId: string, schoolId: string, membershipId: string, name: string) => `schoolconnect:cache:${userId}:${schoolId}:${membershipId}:${encodeURIComponent(name)}`;
const CACHE_TTL_MS = 24 * 3_600_000;
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(action);
  locks.set(name, pending);
  try { return await pending; }
  finally { if (locks.get(name) === pending) locks.delete(name); }
}

export async function queuedMutations(userId: string): Promise<QueuedMutation[]> {
  const stored = await secureOfflineStorage.getItem(userId, key(userId));
  return stored ? JSON.parse(stored) as QueuedMutation[] : [];
}

export async function queueMutation(entry: QueuedMutation) {
  await withLock(`queue:${entry.userId}`, async () => {
    const items = await queuedMutations(entry.userId);
    if (items.some((item) => item.id === entry.id)) return;
    if (items.length >= 100) throw new Error('OFFLINE_QUEUE_FULL');
    items.push(entry);
    await secureOfflineStorage.setItem(entry.userId, key(entry.userId), JSON.stringify(items));
  });
}

export async function removeQueuedMutation(userId: string, id: string) {
  await withLock(`queue:${userId}`, async () => {
    await secureOfflineStorage.setItem(userId, key(userId), JSON.stringify((await queuedMutations(userId)).filter((item) => item.id !== id)));
  });
}

export async function replayMutations(context: { userId: string; membershipId: string; schoolId: string | null }, send: (item: QueuedMutation) => Promise<unknown>) {
  return withLock(`replay:${context.userId}:${context.membershipId}:${context.schoolId}`, () => replayInOrder(context, send));
}

async function replayInOrder(context: { userId: string; membershipId: string; schoolId: string | null }, send: (item: QueuedMutation) => Promise<unknown>) {
  const items = await queuedMutations(context.userId);
  let completed = 0;
  for (const item of items) {
    if (item.membershipId !== context.membershipId || item.schoolId !== context.schoolId) continue;
    if (item.state === 'CONFLICT') break;
    try {
      await send(item);
      completed += 1;
      await removeQueuedMutation(context.userId, item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SYNC_FAILED';
      if (/CONFLICT|HTTP_409|SUPERSEDED|NOT_AUTHORIZED|ACCESS_DENIED|INACTIVE/.test(message)) {
        await withLock(`queue:${context.userId}`, async () => {
          const latest = await queuedMutations(context.userId);
          await secureOfflineStorage.setItem(context.userId, key(context.userId), JSON.stringify(latest.map((queued) => queued.id === item.id ? { ...queued, state: 'CONFLICT', error: message } : queued)));
        });
      }
      // Preserve ordering. A later write may depend on this one.
      break;
    }
  }
  return { completed, remaining: (await queuedMutations(context.userId)).length };
}

export async function cachePublicTimeline(userId: string, schoolId: string, studentId: string, posts: unknown[]) {
  const safe = posts.filter((post) => typeof post === 'object' && post !== null && 'postType' in post && post.postType !== 'RESULT');
  await secureOfflineStorage.setItem(userId, cacheKey(userId, schoolId, studentId), JSON.stringify({ cachedAt: Date.now(), posts: safe }));
}

export async function cachedPublicTimeline<T>(userId: string, schoolId: string, studentId: string): Promise<T[]> {
  const raw = await secureOfflineStorage.getItem(userId, cacheKey(userId, schoolId, studentId));
  if (!raw) return [];
  const value = JSON.parse(raw) as { cachedAt: number; posts: T[] };
  return Date.now() - value.cachedAt < CACHE_TTL_MS ? value.posts : [];
}

export async function cacheChildren(userId: string, schoolId: string, children: unknown[]) {
  await secureOfflineStorage.setItem(userId, childrenKey(userId, schoolId), JSON.stringify({ cachedAt: Date.now(), children }));
}

export async function cachedChildren<T>(userId: string, schoolId: string): Promise<T[]> {
  const raw = await secureOfflineStorage.getItem(userId, childrenKey(userId, schoolId));
  if (!raw) return [];
  const value = JSON.parse(raw) as { cachedAt: number; children: T[] };
  return Date.now() - value.cachedAt < CACHE_TTL_MS ? value.children : [];
}

export async function cacheScopedRead<T>(userId: string, schoolId: string, membershipId: string, name: string, value: T) {
  await secureOfflineStorage.setItem(userId, scopedKey(userId, schoolId, membershipId, name), JSON.stringify({ cachedAt: Date.now(), value }));
}

export async function cachedScopedRead<T>(userId: string, schoolId: string, membershipId: string, name: string): Promise<T | null> {
  const raw = await secureOfflineStorage.getItem(userId, scopedKey(userId, schoolId, membershipId, name));
  if (!raw) return null;
  const cached = JSON.parse(raw) as { cachedAt: number; value: T };
  return Date.now() - cached.cachedAt < CACHE_TTL_MS ? cached.value : null;
}

export async function clearOfflineUserData(userId: string) {
  const keys = await secureOfflineStorage.getAllKeys();
  await secureOfflineStorage.multiRemove(keys.filter((item) => item === key(userId) || item.startsWith(`schoolconnect:cache:${userId}:`) || item.startsWith(`schoolconnect:draft:${userId}:`) || item.startsWith(`draft:${userId}:`)));
  await secureOfflineStorage.clearUserKey(userId);
}
