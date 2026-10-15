import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgConsumerFailures, PgOutbox, type EventEnvelope } from '@schoolconnect/eventing';
import { ReadRepository } from './repository';

const databaseUrl=process.env.EVENTING_DB_TEST_URL;
// Explicit local-only opt-in. Never use a school database, even on localhost.
describe.skipIf(!databaseUrl)('event recovery against isolated local PostgreSQL', () => {
  const schema=`eventing_test_${randomUUID().replaceAll('-','')}`;
  let pool:Pool, repository:ReadRepository;
  const schoolId=randomUUID(),teacherId=randomUUID(),parentId=randomUUID(),studentId=randomUUID();
  beforeAll(async () => {
    const url=new URL(databaseUrl!);
    if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname!=='/schoolconnect_eventing_test') throw new Error('ISOLATED_LOCAL_EVENTING_DATABASE_REQUIRED');
    if (!/^eventing_test_[0-9a-f]{32}$/.test(schema)) throw new Error('UNSAFE_TEST_SCHEMA');
    url.searchParams.set('options',`-c search_path=${schema}`);
    vi.stubEnv('READ_DATABASE_URL',url.toString());
    pool=new Pool({connectionString:url.toString(),connectionTimeoutMillis:3000});
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const base=await readFile(resolve(__dirname,'../../../infra/postgres/init/100-read-model.sql'),'utf8');
    await pool.query(base.replace(/^\\connect.*$/gm,'').replace(/^CREATE EXTENSION.*$/gm,''));
    const content=await readFile(resolve(__dirname,'../../../infra/postgres/init/030-content.sql'),'utf8');
    await pool.query(content.slice(content.indexOf('CREATE TABLE outbox_events')));
    const recovery=await readFile(resolve(__dirname,'../../../infra/postgres/init/104-event-recovery.sql'),'utf8');
    const outbox=recovery.split('\\connect schoolconnect_content')[1]!.split('\\connect')[0]!;
    const reader=recovery.split('\\connect schoolconnect_read')[1]!;
    await pool.query(outbox);await pool.query(reader);
    // Both additive segments are safe to reapply without losing failure records.
    await pool.query(outbox);await pool.query(reader);
    repository=new ReadRepository();
  });
  afterAll(async () => {
    await repository?.onModuleDestroy();
    if (pool) {
      // Only the exact randomly generated synthetic schema above is removed.
      if (!/^eventing_test_[0-9a-f]{32}$/.test(schema)) throw new Error('UNSAFE_TEST_SCHEMA');
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();
    }
    vi.unstubAllEnvs();
  });
  const postEvent=(postId=randomUUID(),revision=1):EventEnvelope => ({source:'content',event:{id:randomUUID(),aggregateId:postId,eventType:'content.post-published.v1',occurredAt:new Date().toISOString(),payload:{schoolId,post:{id:postId,schoolId,authorMembershipId:teacherId,postType:'ANNOUNCEMENT',status:'PUBLISHED',title:`Revision ${revision}`,body:'Synthetic',revisionNumber:revision},recipients:[{guardianUserId:parentId,studentId}]}}});
  it('does not repeat projection effects for duplicate Kafka delivery',async () => {
    const event=postEvent();await repository.consume(event);await repository.consume(event);
    expect((await pool.query('SELECT count(*)::int AS count FROM consumed_events WHERE event_id=$1',[event.event.id])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM read_posts WHERE post_id=$1',[event.event.aggregateId])).rows[0].count).toBe(1);
  });
  it('keeps a newer projection when an older revision is replayed',async () => {
    const id=randomUUID();await repository.consume(postEvent(id,2));await repository.consume(postEvent(id,1));
    expect((await pool.query('SELECT revision_number FROM read_posts WHERE post_id=$1',[id])).rows[0].revision_number).toBe(2);
  });
  it('preserves archive-before-publish ordering when a quarantined publish is replayed',async () => {
    const original=postEvent();
    await repository.consume({source:'content',event:{id:randomUUID(),aggregateId:original.event.aggregateId,eventType:'content.post-archived.v1',occurredAt:new Date().toISOString(),payload:{schoolId}}});
    await repository.consume(original);
    expect((await pool.query('SELECT count(*)::int AS count FROM read_posts WHERE post_id=$1',[original.event.aggregateId])).rows[0].count).toBe(0);
  });
  it('rolls back the receipt and post if a recipient projection fails',async () => {
    const event=postEvent();event.event.payload.recipients=[{guardianUserId:'not-a-uuid',studentId}];
    await expect(repository.consume(event)).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS count FROM consumed_events WHERE event_id=$1',[event.event.id])).rows[0].count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM read_posts WHERE post_id=$1',[event.event.aggregateId])).rows[0].count).toBe(0);
  });
  it('fences stale outbox completion after another publisher reclaims an expired lease',async () => {
    const id=randomUUID();await pool.query('INSERT INTO outbox_events(id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4)',[id,'content.post-published.v1',randomUUID(),{schoolId}]);
    const outbox=new PgOutbox(pool),first=(await outbox.claim(1))[0]!;
    await pool.query("UPDATE outbox_events SET available_at=now()-interval '1 second' WHERE id=$1",[id]);
    expect(await outbox.renew(id,first.claimToken!)).toBe(false);
    const second=(await outbox.claim(1))[0]!;expect(second.claimToken).not.toBe(first.claimToken);
    expect((await outbox.complete(id,true,first.claimToken)).completed).toBe(false);
    expect((await outbox.complete(id,true,second.claimToken)).completed).toBe(true);
  });
  it('keeps exact 64-bit Kafka offsets, deduplicates quarantine and excludes raw data from diagnostics',async () => {
    const failures=new PgConsumerFailures(pool,'test-group'),event=postEvent();
    const record={topic:'test-events',partition:0,offset:'9007199254740993',value:Buffer.from(JSON.stringify(event))};
    await failures.quarantine(record,'TEST_ERROR',3,event);await failures.quarantine(record,'TEST_ERROR',3,event);
    const rows=await failures.list();expect(rows).toHaveLength(1);expect(rows[0]?.offset).toBe(record.offset);expect(rows[0]?.attemptCount).toBe(6);expect(rows[0]).not.toHaveProperty('raw_value');
  });
  it('allows only one simultaneous replay claim and resolves after successful application',async () => {
    const failures=new PgConsumerFailures(pool,'replay-group'),event=postEvent();
    await failures.quarantine({topic:'test',partition:0,offset:'1',value:Buffer.from(JSON.stringify(event))},'TEST_ERROR',3,event);
    const id=String((await failures.list())[0]?.id);
    let finish!: () => void,started!: () => void;
    const ready=new Promise<void>((resolve) => {started=resolve;});
    const handler=vi.fn(async () => {started();await new Promise<void>((resolve) => {finish=resolve;});});
    const first=failures.replay(id,teacherId,handler);await ready;
    await expect(failures.replay(id,teacherId,handler)).rejects.toThrow('EVENT_REPLAY_BUSY_OR_RESOLVED');
    finish();expect(await first).toEqual({id,state:'RESOLVED'});expect(handler).toHaveBeenCalledOnce();
  });
});
