import { Kafka, logLevel, type Consumer, type Producer, type SASLOptions } from 'kafkajs';
import { consumeWithRecovery, type RecoveryOptions } from './recovery';
import { eventErrorCode } from './storage';
export * from './storage';
export * from './recovery';
export * from './lifecycle';

export type EventSource = 'identity' | 'school' | 'content' | 'attendance' | 'files' | 'notifications' | 'fees';
export type OutboxEvent = { id: string; eventType: string; aggregateId: string; payload: Record<string, unknown>; occurredAt: string; claimToken?: string; attemptCount?: number };
export type EventEnvelope = { source: EventSource; event: OutboxEvent };
export type OutboxRepository = { claimOutbox(limit: number): Promise<OutboxEvent[]>; completeOutbox(eventId: string, success: boolean, claimToken?: string, errorCode?: string): Promise<unknown>; renewOutbox(eventId: string, claimToken: string): Promise<boolean> };

type TransportState = { connected: boolean; lastSuccessAt?: string; lastErrorCode?: string; failures: number; quarantined: number };
const states = new Map<string, TransportState>();
const stateFor = (key: string) => { const state: TransportState={connected:false,failures:0,quarantined:0}; states.set(key,state); return state; };
export function eventingStatus(...keys: string[]) {
  return keys.map((key) => ({ name:key,...states.get(key) }));
}
export function eventingHealth(...keys: string[]) {
  return eventingStatus(...keys).every((state) => state.connected===true) ? 'ok' : 'degraded';
}
function numberSetting(name: string, fallback: number, min: number, max: number) {
  const value=Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value<min || value>max) throw new Error(`${name}_INVALID`);
  return value;
}

export function parseEventEnvelope(value: string): EventEnvelope {
  let parsed: unknown;
  try { parsed=JSON.parse(value); } catch { throw new Error('KAFKA_EVENT_JSON_INVALID'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('KAFKA_EVENT_ENVELOPE_INVALID');
  const envelope = parsed as Partial<EventEnvelope>;
  if (typeof envelope.source !== 'string' || !['identity', 'school', 'content', 'attendance', 'files', 'notifications', 'fees'].includes(envelope.source)) throw new Error('KAFKA_EVENT_SOURCE_INVALID');
  const event = envelope.event;
  if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id) || typeof event.eventType !== 'string' || !event.eventType || event.eventType.length>120 ||
      typeof event.aggregateId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.aggregateId) || typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt)) ||
      !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('KAFKA_EVENT_PAYLOAD_INVALID');
  if (!event.eventType.startsWith(`${envelope.source}.`)) throw new Error('KAFKA_EVENT_OWNER_INVALID');
  return { source: envelope.source, event };
}

export function kafkaConnectionConfig(environment: NodeJS.ProcessEnv = process.env) {
  const brokers = (environment.KAFKA_BROKERS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!brokers.length) throw new Error('KAFKA_BROKERS_REQUIRED');
  const tlsEnabled = environment.KAFKA_SSL === 'true';
  const mechanism = environment.KAFKA_SASL_MECHANISM;
  if (mechanism && !tlsEnabled) throw new Error('KAFKA_SASL_REQUIRES_TLS');
  if (mechanism && !['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism)) throw new Error('KAFKA_SASL_MECHANISM_INVALID');
  const username = environment.KAFKA_SASL_USERNAME;
  const password = environment.KAFKA_SASL_PASSWORD;
  if (mechanism && (!username || !password)) throw new Error('KAFKA_SASL_CREDENTIALS_REQUIRED');
  const encodedCa = environment.KAFKA_CA_CERT_BASE64;
  if (encodedCa && !tlsEnabled) throw new Error('KAFKA_CA_REQUIRES_TLS');
  const ca = encodedCa ? Buffer.from(encodedCa, 'base64').toString('utf8') : undefined;
  if (ca && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(ca)) throw new Error('KAFKA_CA_CERT_INVALID');
  const sasl: SASLOptions | undefined = mechanism === 'plain' ? { mechanism, username: username!, password: password! }
    : mechanism === 'scram-sha-256' ? { mechanism, username: username!, password: password! }
      : mechanism === 'scram-sha-512' ? { mechanism, username: username!, password: password! } : undefined;
  return { brokers, ssl: tlsEnabled ? ca ? { ca: [ca] } : true : false, sasl };
}

function client(clientId: string) {
  return new Kafka({ clientId, ...kafkaConnectionConfig(), logLevel: logLevel.NOTHING,
    connectionTimeout:5000, requestTimeout:10000, retry:{retries:3,initialRetryTime:300,maxRetryTime:5000} });
}

const topic = () => process.env.KAFKA_EVENT_TOPIC ?? 'schoolconnect.domain-events.v1';

export async function ensureTopic(clientId: string) {
  if (process.env.KAFKA_CREATE_TOPIC !== 'true') return;
  const admin = client(clientId).admin();
  await admin.connect();
  try {
    await admin.createTopics({ waitForLeaders: true, topics: [{ topic: topic(), numPartitions: Number(process.env.KAFKA_PARTITIONS ?? 3), replicationFactor: Number(process.env.KAFKA_REPLICATION_FACTOR ?? 1) }] });
  } finally { await admin.disconnect(); }
}

export async function startOutboxPublisher(source: EventSource, repository: OutboxRepository): Promise<() => Promise<void>> {
  let producer: Producer | null = null;
  let inFlight: Promise<void> | undefined;
  let closed = false;
  const state=stateFor(`publisher:${source}`);
  const pump = async () => {
    try {
      if (!producer) {
        await ensureTopic(`schoolconnect-${source}-admin`);
        const candidate = client(`schoolconnect-${source}-publisher`).producer({ allowAutoTopicCreation: false });
        try { await candidate.connect(); }
        catch (error) { await candidate.disconnect().catch(() => undefined); throw error; }
        if (closed) { await candidate.disconnect(); return; }
        producer = candidate;
        state.connected=true;
      }
      if (closed) return;
      const events = await repository.claimOutbox(25);
      for (const event of events) {
        if (closed || !producer) {
          await repository.completeOutbox(event.id,false,event.claimToken,'PUBLISHER_CONNECTION_LOST');
          continue;
        }
        if (!event.claimToken || !await repository.renewOutbox(event.id,event.claimToken)) continue;
        const activeProducer=producer;
        try {
          const publicEvent: OutboxEvent={id:event.id,eventType:event.eventType,aggregateId:event.aggregateId,payload:event.payload,occurredAt:event.occurredAt};
          await activeProducer.send({ topic: topic(), acks: -1, messages: [{ key: `${String(event.payload.schoolId ?? '')}:${event.aggregateId}`,
            value: JSON.stringify({ source, event:publicEvent } satisfies EventEnvelope), headers: { 'x-correlation-id': String(event.payload.correlationId ?? event.id) } }] });
        } catch (error) {
          state.connected=false; state.failures++; state.lastErrorCode=eventErrorCode(error);
          console.error('outbox-publish-failed',source,event.id,state.lastErrorCode);
          await activeProducer.disconnect().catch(() => undefined); producer=null;
          await repository.completeOutbox(event.id,false,event.claimToken,state.lastErrorCode);
          continue;
        }
        // If completion fails after Kafka ACK, leave the lease for redelivery.
        // Never mark an acknowledged event failed simply because the DB is down.
        await repository.completeOutbox(event.id,true,event.claimToken);
        state.lastSuccessAt=new Date().toISOString(); state.lastErrorCode=undefined;
      }
    } catch (error) { state.failures++; state.lastErrorCode=eventErrorCode(error); console.error('outbox-pump-failed',source,state.lastErrorCode); }
  };
  const interval=numberSetting('OUTBOX_POLL_INTERVAL_MS',2000,250,60000);
  const tick=() => { if (!closed && !inFlight) inFlight=pump().finally(() => {inFlight=undefined;}); };
  tick();
  const timer=setInterval(tick,interval);
  return async () => { closed=true; clearInterval(timer); await inFlight; await producer?.disconnect(); producer=null; state.connected=false; };
}

export async function startEventConsumer(groupId: string, handler: (envelope: EventEnvelope) => Promise<void>, options: RecoveryOptions): Promise<() => Promise<void>> {
  let consumer: Consumer | null = null;
  let connecting: Promise<void> | undefined;
  let closed = false;
  const state=stateFor(`consumer:${groupId}`);
  const recovery={...options,maxAttempts:options.maxAttempts ?? numberSetting('KAFKA_HANDLER_MAX_ATTEMPTS',3,1,10),
    retryDelayMs:options.retryDelayMs ?? numberSetting('KAFKA_HANDLER_RETRY_DELAY_MS',1000,1,5000)};
  const connect = async () => {
    const candidate = client(`schoolconnect-${groupId}`).consumer({ groupId, allowAutoTopicCreation: false });
    const failed=async (error:unknown) => {
      state.connected=false; state.failures++; state.lastErrorCode=eventErrorCode(error);
      console.error('kafka-consumer-failed',groupId,state.lastErrorCode);
      await candidate.disconnect().catch(() => undefined);
      if (consumer===candidate) consumer=null;
    };
    candidate.on(candidate.events.GROUP_JOIN, () => { state.connected=true; state.lastErrorCode=undefined; });
    candidate.on(candidate.events.CRASH, ({payload}) => {
      state.connected=false; state.lastErrorCode=eventErrorCode(payload.error);
      if (!payload.restart) void failed(payload.error);
    });
    try {
      await candidate.connect();
      await candidate.subscribe({ topic: topic(), fromBeginning: true });
      if (closed) { await candidate.disconnect(); return; }
      consumer = candidate;
      await candidate.run({ eachMessage: async ({topic,partition,message,heartbeat}) => {
        // Heartbeat throughout slow fanout/retries so the group does not evict us.
        const heartbeatTimer=setInterval(() => { void heartbeat().catch(() => undefined); },2500);
        try {
          const result=await consumeWithRecovery({topic,partition,offset:message.offset,value:message.value,key:message.key},handler,heartbeat,recovery);
          if (result.quarantined) {
            state.quarantined++;state.failures++;state.lastErrorCode='EVENT_QUARANTINED';
            console.error('event-quarantined',groupId,topic,partition,message.offset);
          } else {state.lastSuccessAt=new Date().toISOString();state.lastErrorCode=undefined;}
          await heartbeat();
        } finally {clearInterval(heartbeatTimer);}
      } });
    } catch (error) { await failed(error); }
  };
  const tick=() => {if (!closed && !consumer && !connecting) connecting=connect().finally(() => {connecting=undefined;});};
  tick();
  const timer=setInterval(tick,5000);
  return async () => {closed=true;clearInterval(timer);await connecting;await consumer?.stop();await consumer?.disconnect();consumer=null;state.connected=false;};
}
