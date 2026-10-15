import { beforeEach, describe, expect, it, vi } from 'vitest';
const database=vi.hoisted(() => ({ query:vi.fn(),release:vi.fn(),end:vi.fn() }));
vi.mock('pg',() => ({Pool:class {
  query=database.query; end=database.end;
  async connect() {return database;}
}}));
import { ReadRepository } from './repository';
import type { EventEnvelope } from '@schoolconnect/eventing';
const event:EventEnvelope={source:'content',event:{id:'event-1',aggregateId:'post-1',eventType:'content.post-published.v1',occurredAt:'2026-10-14T00:00:00Z',payload:{schoolId:'school-1',post:{id:'post-1',schoolId:'school-1',authorMembershipId:'teacher-1',postType:'ANNOUNCEMENT',status:'PUBLISHED',title:'Notice',body:'Details',revisionNumber:1},recipients:[{guardianUserId:'parent-1',studentId:'child-1'}]}}};
beforeEach(() => {
  database.query.mockReset().mockImplementation(async (sql:string) => ({rows:[],rowCount:sql.includes('SELECT 1 FROM consumed_events') ? 0 : 1}));database.release.mockReset();
});
describe('event-built read projection recovery', () => {
  it('commits the receipt and projection together with tenant-scoped receipt metadata',async () => {
    await new ReadRepository().consume(event);
    expect(database.query.mock.calls[0]?.[0]).toBe('BEGIN');expect(database.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO consumed_events'),['event-1','content.post-published.v1','post-1','school-1']);
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO read_posts'))).toBe(true);
  });
  it('does not repeat projection mutations for duplicate delivery',async () => {
    database.query.mockImplementation(async (sql:string) => ({rows:[],rowCount:sql.includes('INSERT INTO consumed_events') ? 0 : 1}));
    await new ReadRepository().consume(event);
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO read_posts'))).toBe(false);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rolls back the receipt if projection application fails, allowing redelivery',async () => {
    database.query.mockImplementation(async (sql:string) => {if(sql.includes('INSERT INTO read_posts'))throw new Error('DB unavailable');return {rows:[],rowCount:sql.includes('SELECT 1') ? 0 : 1};});
    await expect(new ReadRepository().consume(event)).rejects.toThrow('DB unavailable');
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(database.release).toHaveBeenCalledOnce();
  });
  it('rejects a snapshot whose tenant differs from its event scope',async () => {
    await expect(new ReadRepository().consume({...event,event:{...event.event,payload:{...event.event.payload,schoolId:'other-school'}}})).rejects.toThrow('POST_PROJECTION_TENANT_INVALID');
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('does not resurrect a post when an earlier failed publish is replayed after archive',async () => {
    database.query.mockResolvedValue({rows:[],rowCount:1});
    await new ReadRepository().consume(event);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('SELECT 1 FROM consumed_events'),['post-1','school-1','content.post-archived.v1']);
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO read_posts'))).toBe(false);
  });
  it('guards upserts against older revisions and terminal archived state',async () => {
    await new ReadRepository().consume(event);
    const upsert=database.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO read_posts'))?.[0];
    expect(upsert).toContain("read_posts.status<>'ARCHIVED'");expect(upsert).toContain('read_posts.revision_number<=excluded.revision_number');
  });
});
