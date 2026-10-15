import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(() => ({
  producer:{connect:vi.fn(),disconnect:vi.fn(),send:vi.fn()},
  consumer:{connect:vi.fn(),disconnect:vi.fn(),subscribe:vi.fn(),run:vi.fn(),stop:vi.fn(),on:vi.fn(),events:{GROUP_JOIN:'join',CRASH:'crash'}},
}));
vi.mock('kafkajs', () => ({logLevel:{NOTHING:0},Kafka:class {
  producer() {return mocks.producer;} consumer() {return mocks.consumer;}
}}));
import { eventingStatus, startEventConsumer, startOutboxPublisher } from './index';
const event={id:'event-1',eventType:'content.post-published.v1',aggregateId:'post-1',occurredAt:'2026-10-14T00:00:00Z',payload:{schoolId:'school-1'},claimToken:'claim-1'};
let stop: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.useFakeTimers();vi.stubEnv('KAFKA_BROKERS','localhost:9092');vi.stubEnv('KAFKA_CREATE_TOPIC','false');vi.stubEnv('OUTBOX_POLL_INTERVAL_MS','2000');
  for (const mock of [mocks.producer.connect,mocks.producer.disconnect,mocks.producer.send,mocks.consumer.connect,mocks.consumer.disconnect,mocks.consumer.subscribe,mocks.consumer.run,mocks.consumer.stop]) mock.mockReset().mockResolvedValue(undefined);
  mocks.consumer.on.mockReset();stop=undefined;
});
afterEach(async () => {await stop?.();vi.useRealTimers();vi.unstubAllEnvs();});
const repository=() => ({claimOutbox:vi.fn().mockResolvedValue([]),completeOutbox:vi.fn().mockResolvedValue({completed:true}),renewOutbox:vi.fn().mockResolvedValue(true)});
describe('publisher recovery', () => {
  it('never sends the tail of a failed batch through a disconnected producer and reconnects on the next two-second tick',async () => {
    const repo=repository();repo.claimOutbox.mockResolvedValueOnce([event,{...event,id:'event-2',claimToken:'claim-2'}]);
    mocks.producer.send.mockRejectedValueOnce(new Error('BROKER_UNAVAILABLE'));
    stop=await startOutboxPublisher('content',repo);await vi.advanceTimersByTimeAsync(0);
    expect(mocks.producer.send).toHaveBeenCalledOnce();expect(repo.completeOutbox).toHaveBeenCalledWith('event-1',false,'claim-1','BROKER_UNAVAILABLE');
    expect(repo.completeOutbox).toHaveBeenCalledWith('event-2',false,'claim-2','PUBLISHER_CONNECTION_LOST');
    await vi.advanceTimersByTimeAsync(2000);expect(mocks.producer.connect).toHaveBeenCalledTimes(2);
  });
  it('does not mark a Kafka-acknowledged event failed when outbox completion throws',async () => {
    const repo=repository();repo.claimOutbox.mockResolvedValueOnce([event]);repo.completeOutbox.mockRejectedValueOnce(new Error('DB unavailable'));
    stop=await startOutboxPublisher('content',repo);await vi.advanceTimersByTimeAsync(0);
    expect(repo.completeOutbox).toHaveBeenCalledOnce();expect(repo.completeOutbox).toHaveBeenCalledWith('event-1',true,'claim-1');expect(mocks.producer.disconnect).not.toHaveBeenCalled();
  });
  it('does not publish work whose lease has been lost',async () => {
    const repo=repository();repo.claimOutbox.mockResolvedValueOnce([event]);repo.renewOutbox.mockResolvedValue(false);
    stop=await startOutboxPublisher('content',repo);await vi.advanceTimersByTimeAsync(0);
    expect(mocks.producer.send).not.toHaveBeenCalled();expect(repo.completeOutbox).not.toHaveBeenCalled();
  });
  it('shutdown waits for connection then disconnects without claiming new work',async () => {
    let connected!: () => void;mocks.producer.connect.mockImplementation(() => new Promise<void>((resolve) => {connected=resolve;}));
    const repo=repository();stop=await startOutboxPublisher('content',repo);await vi.advanceTimersByTimeAsync(0);
    const closing=stop();connected();await closing;expect(repo.claimOutbox).not.toHaveBeenCalled();expect(mocks.producer.disconnect).toHaveBeenCalledOnce();
    expect(eventingStatus('publisher:content')[0]?.connected).toBe(false);
  });
});
describe('consumer recovery', () => {
  it('reconnects after a non-restarting KafkaJS CRASH event',async () => {
    stop=await startEventConsumer('group',vi.fn(),{failureStore:{quarantine:vi.fn()}});await vi.advanceTimersByTimeAsync(0);
    const listener=mocks.consumer.on.mock.calls.find(([event]) => event==='crash')?.[1] as (event:{payload:{restart:boolean;error:Error}}) => void;
    listener({payload:{restart:false,error:new Error('CRASHED')}});await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.consumer.connect).toHaveBeenCalledTimes(2);
  });
  it('lets KafkaJS recover a restarting crash without creating a duplicate consumer',async () => {
    stop=await startEventConsumer('group',vi.fn(),{failureStore:{quarantine:vi.fn()}});await vi.advanceTimersByTimeAsync(0);
    const listener=mocks.consumer.on.mock.calls.find(([event]) => event==='crash')?.[1] as (event:{payload:{restart:boolean;error:Error}}) => void;
    listener({payload:{restart:true,error:new Error('CRASHED')}});await vi.advanceTimersByTimeAsync(5000);expect(mocks.consumer.connect).toHaveBeenCalledOnce();
  });
  it('stops consumption before disconnect during shutdown',async () => {
    stop=await startEventConsumer('group',vi.fn(),{failureStore:{quarantine:vi.fn()}});await vi.advanceTimersByTimeAsync(0);await stop();
    expect(mocks.consumer.stop.mock.invocationCallOrder[0]).toBeLessThan(mocks.consumer.disconnect.mock.invocationCallOrder[0]!);
  });
});
