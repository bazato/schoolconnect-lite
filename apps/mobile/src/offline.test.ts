import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('./secureOfflineStorage', () => ({ secureOfflineStorage: {
  getItem: async (_userId: string, key: string) => storage.get(key) ?? null,
  setItem: async (_userId: string, key: string, value: string) => { storage.set(key, value); },
  getAllKeys: async () => [...storage.keys()],
  multiRemove: async (keys: string[]) => { for (const key of keys) storage.delete(key); },
  clearUserKey: async () => undefined,
} }));

import { cacheChildren, cachedChildren, cachePublicTimeline, cachedPublicTimeline, cacheScopedRead, cachedScopedRead, clearOfflineUserData, queueMutation, queuedMutations, replayMutations } from './offline';

const entry = (id: string, membershipId = 'teacher') => ({
  id, userId: 'user-1', membershipId, schoolId: 'school-1', method: 'POST' as const,
  path: '/attendance/batches', body: { idempotencyKey: id }, createdAt: new Date().toISOString(), state: 'PENDING' as const,
});

describe('scoped offline queue', () => {
  beforeEach(() => storage.clear());

  it('deduplicates entries and replays only the active membership', async () => {
    await queueMutation(entry('one'));
    await queueMutation(entry('one'));
    await queueMutation(entry('other', 'parent'));
    const sent: string[] = [];
    const result = await replayMutations({ userId: 'user-1', membershipId: 'teacher', schoolId: 'school-1' }, async (item) => { sent.push(item.id); });
    expect(sent).toEqual(['one']);
    expect(result).toEqual({ completed: 1, remaining: 1 });
  });

  it('marks a conflict and leaves subsequent changes unsent', async () => {
    await queueMutation(entry('one'));
    await queueMutation(entry('two'));
    const sent: string[] = [];
    await replayMutations({ userId: 'user-1', membershipId: 'teacher', schoolId: 'school-1' }, async (item) => {
      sent.push(item.id);
      throw new Error('HTTP_409');
    });
    expect(sent).toEqual(['one']);
    expect((await queuedMutations('user-1'))[0]?.state).toBe('CONFLICT');
    await replayMutations({ userId: 'user-1',membershipId: 'teacher',schoolId: 'school-1' },async (item)=>{ sent.push(item.id); });
    expect(sent).toEqual(['one']);
  });

  it('never caches results and clears all user-scoped data on logout', async () => {
    await cacheChildren('user-1', 'school-1', [{ id: 'student-1' }]);
    await cachePublicTimeline('user-1', 'school-1', 'student-1', [
      { id: 'notice', postType: 'ANNOUNCEMENT' }, { id: 'result', postType: 'RESULT' },
    ]);
    expect(await cachedChildren<{ id: string }>('user-1', 'school-1')).toHaveLength(1);
    expect(await cachedPublicTimeline<{ id: string }>('user-1', 'school-1', 'student-1')).toEqual([{ id: 'notice', postType: 'ANNOUNCEMENT' }]);
    await clearOfflineUserData('user-1');
    expect(storage.size).toBe(0);
  });

  it('keeps roster caches separate for each verified membership', async () => {
    await cacheScopedRead('user-1', 'school-1', 'teacher', '/attendance/roster?classId=A', [{ id: 'student-1' }]);
    expect(await cachedScopedRead('user-1', 'school-1', 'teacher', '/attendance/roster?classId=A')).toEqual([{ id: 'student-1' }]);
    expect(await cachedScopedRead('user-1', 'school-1', 'parent', '/attendance/roster?classId=A')).toBeNull();
  });

  it('does not lose concurrent additions or replay a change twice', async () => {
    await Promise.all(Array.from({ length: 20 }, (_,index) => queueMutation(entry(String(index)))));
    expect(await queuedMutations('user-1')).toHaveLength(20);
    const sent: string[] = [];
    const context = { userId:'user-1',membershipId:'teacher',schoolId:'school-1' };
    await Promise.all([0,1].map(()=>replayMutations(context,async (item)=>{ sent.push(item.id); })));
    expect(new Set(sent).size).toBe(20);
    expect(sent).toHaveLength(20);
  });
});
