import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeWithRecovery, parseEventEnvelope, PgConsumerFailures, PgOutbox, eventErrorCode, bindEventingShutdown, registerApplicationShutdown, shutdownApplications } from './index';
const envelope={source:'content',event:{id:'event-1',eventType:'content.post-published.v1',aggregateId:'post-1',occurredAt:'2026-10-14T00:00:00Z',payload:{schoolId:'school-1'}}};
const record={topic:'events',partition:0,offset:'9007199254740993',value:Buffer.from(JSON.stringify(envelope))};
afterEach(() => vi.useRealTimers());
describe('durable consumer recovery', () => {
  it('does not write a failure record for normal successful processing',async () => {
    const quarantine=vi.fn(),handler=vi.fn().mockResolvedValue(undefined);
    expect(await consumeWithRecovery(record,handler,vi.fn(),{failureStore:{quarantine}})).toEqual({quarantined:false});
    expect(handler).toHaveBeenCalledWith(envelope);expect(quarantine).not.toHaveBeenCalled();
  });
  it.each([null,Buffer.from('not-json'),Buffer.from('{}')])('durably quarantines malformed records before returning: %j',async (value) => {
    const quarantine=vi.fn().mockResolvedValue(undefined),handler=vi.fn();
    expect(await consumeWithRecovery({...record,value},handler,vi.fn(),{failureStore:{quarantine}})).toEqual({quarantined:true});
    expect(handler).not.toHaveBeenCalled();expect(quarantine).toHaveBeenCalledOnce();
  });
  it('does not advance past poison data when the failure store is unavailable',async () => {
    await expect(consumeWithRecovery({...record,value:null},vi.fn(),vi.fn(),{failureStore:{quarantine:vi.fn().mockRejectedValue(new Error('store down'))}})).rejects.toThrow('store down');
  });
  it('retries a temporary handler failure with heartbeats then succeeds',async () => {
    vi.useFakeTimers();const handler=vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined),heartbeat=vi.fn(),quarantine=vi.fn();
    const running=consumeWithRecovery(record,handler,heartbeat,{failureStore:{quarantine},retryDelayMs:1000});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await running).toEqual({quarantined:false});expect(handler).toHaveBeenCalledTimes(2);expect(heartbeat).toHaveBeenCalledOnce();expect(quarantine).not.toHaveBeenCalled();
  });
  it('bounds handler retries and persists exact Kafka coordinates and bytes',async () => {
    vi.useFakeTimers();const handler=vi.fn().mockRejectedValue(new Error('private password: secret')),quarantine=vi.fn().mockResolvedValue(undefined);
    const running=consumeWithRecovery(record,handler,vi.fn(),{failureStore:{quarantine},retryDelayMs:1000});
    await vi.advanceTimersByTimeAsync(2000);expect(await running).toEqual({quarantined:true});
    expect(handler).toHaveBeenCalledTimes(3);expect(quarantine).toHaveBeenCalledWith(record,'EVENT_PROCESSING_FAILED',3,envelope);
  });
  it('rejects mismatched event owner, empty IDs and invalid timestamps', () => {
    for (const event of [{...envelope.event,id:''},{...envelope.event,occurredAt:'bad'},{...envelope.event,eventType:'school.created.v1'}]) expect(() => parseEventEnvelope(JSON.stringify({...envelope,event}))).toThrow();
    expect(() => parseEventEnvelope(JSON.stringify({...envelope,source:['content']}))).toThrow();
  });
});
describe('SQL recovery boundaries', () => {
  const db=() => ({query:vi.fn().mockResolvedValue({rows:[],rowCount:1})});
  it('fences outbox completion and renewal by claim token',async () => {
    const database=db(),outbox=new PgOutbox(database);
    expect(await outbox.complete('event',true)).toEqual({completed:false});expect(database.query).not.toHaveBeenCalled();
    await outbox.complete('event',true,'token');
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('claim_token=$2'),['event','token']);
    await outbox.renew('event','token');expect(database.query).toHaveBeenLastCalledWith(expect.stringContaining('available_at>now()'),['event','token']);
  });
  it('claims only pending available rows with SKIP LOCKED and returns fenced tokens',async () => {
    const database=db();await new PgOutbox(database).claim(25);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE SKIP LOCKED'),[25]);
    expect(database.query.mock.calls[0]?.[0]).toContain('claim_token=gen_random_uuid()');
  });
  it('failure diagnostics exclude private raw payload/key and are limited to the service group',async () => {
    const database=db();await new PgConsumerFailures(database,'read-group').list();
    const [sql,values]=database.query.mock.calls[0]!;
    expect(sql).not.toContain('raw_value');expect(sql).not.toContain('raw_key');expect(sql).toContain('LIMIT 50');expect(values).toEqual(['read-group']);
  });
  it('replays only a claimed stored record and resolves it after handler success',async () => {
    const database=db();database.query.mockResolvedValueOnce({rows:[{raw_value:record.value}],rowCount:1});
    const handler=vi.fn().mockResolvedValue(undefined);
    expect(await new PgConsumerFailures(database,'read-group').replay('id','owner',handler)).toEqual({id:'id',state:'RESOLVED'});
    expect(handler).toHaveBeenCalledWith(record.value.toString('utf8'));
    expect(database.query.mock.calls[0]?.[0]).toContain("state='QUARANTINED'");
    expect(database.query.mock.calls[1]?.[0]).toContain('replay_token=$2');
  });
  it('retains failed replays and does not expose private exception messages',async () => {
    const database=db();database.query.mockResolvedValueOnce({rows:[{raw_value:record.value}],rowCount:1});
    expect(await new PgConsumerFailures(database,'read-group').replay('id','owner',vi.fn().mockRejectedValue(new Error('student-name private')))).toEqual({id:'id',state:'QUARANTINED',errorCode:'EVENT_PROCESSING_FAILED'});
  });
  it('rejects concurrent replay claims and already resolved records',async () => {
    const database=db();database.query.mockResolvedValueOnce({rows:[],rowCount:0}).mockResolvedValueOnce({rows:[{state:'REPLAYING'}],rowCount:1});
    const handler=vi.fn();await expect(new PgConsumerFailures(database,'group').replay('id','owner',handler)).rejects.toThrow('EVENT_REPLAY_BUSY_OR_RESOLVED');expect(handler).not.toHaveBeenCalled();
  });
  it('does not turn a failed resolution write into a false resolved result',async () => {
    const database=db();database.query.mockResolvedValueOnce({rows:[{raw_value:record.value}],rowCount:1}).mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(new PgConsumerFailures(database,'group').replay('id','owner',vi.fn().mockResolvedValue(undefined))).rejects.toThrow('DB unavailable');
  });
  it('redacts arbitrary errors but retains safe bounded error codes', () => {
    expect(eventErrorCode({code:'23505',message:'private SQL'})).toBe('23505');
    expect(eventErrorCode(new Error('SNAPSHOT_INVALID'))).toBe('SNAPSHOT_INVALID');
    expect(eventErrorCode({code:'secret: p@ss'})).toBe('EVENT_PROCESSING_FAILED');
  });
  it('drains transports before closing the owner database pool',async () => {
    const order:string[]=[],owner={onModuleDestroy:async () => {order.push('database');}};
    bindEventingShutdown(owner,async () => {order.push('publisher');},async () => {order.push('consumer');});
    await owner.onModuleDestroy();expect(order).toEqual(['publisher','consumer','database']);
  });
  it('drains the bundled gateway, then Kafka, then internal databases',async () => {
    const order:string[]=[],owner={onModuleDestroy:async () => {order.push('database');}};
    bindEventingShutdown(owner,async () => {order.push('kafka');});
    registerApplicationShutdown({close:async () => {order.push('gateway');}},true);
    registerApplicationShutdown({close:() => owner.onModuleDestroy()});
    await shutdownApplications();expect(order).toEqual(['gateway','kafka','database']);
  });
});
