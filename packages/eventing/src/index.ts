import { Kafka, logLevel, type Consumer, type Producer, type SASLOptions } from 'kafkajs';

export type EventSource = 'identity' | 'school' | 'content' | 'attendance' | 'files' | 'notifications';
export type OutboxEvent = { id: string; eventType: string; aggregateId: string; payload: Record<string, unknown>; occurredAt: string };
export type EventEnvelope = { source: EventSource; event: OutboxEvent };
export type OutboxRepository = { claimOutbox(limit: number): Promise<OutboxEvent[]>; completeOutbox(eventId: string, success: boolean): Promise<unknown> };

export function parseEventEnvelope(value: string): EventEnvelope {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('KAFKA_EVENT_ENVELOPE_INVALID');
  const envelope = parsed as Partial<EventEnvelope>;
  if (!['identity', 'school', 'content', 'attendance', 'files', 'notifications'].includes(String(envelope.source))) throw new Error('KAFKA_EVENT_SOURCE_INVALID');
  const event = envelope.event;
  if (!event || typeof event.id !== 'string' || typeof event.eventType !== 'string' || typeof event.aggregateId !== 'string' || typeof event.occurredAt !== 'string' ||
      !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('KAFKA_EVENT_PAYLOAD_INVALID');
  return { source: envelope.source!, event };
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
  return new Kafka({ clientId, ...kafkaConnectionConfig(), logLevel: logLevel.WARN });
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
  let running = false;
  let closed = false;
  const pump = async () => {
    if (running || closed) return;
    running = true;
    try {
      if (!producer) {
        await ensureTopic(`schoolconnect-${source}-admin`);
        const candidate = client(`schoolconnect-${source}-publisher`).producer({ allowAutoTopicCreation: false });
        await candidate.connect();
        producer = candidate;
      }
      const activeProducer = producer;
      const events = await repository.claimOutbox(25);
      for (const event of events) {
        let sent = false;
        try {
          await activeProducer.send({ topic: topic(), acks: -1, messages: [{ key: `${String(event.payload.schoolId ?? '')}:${event.aggregateId}`,
            value: JSON.stringify({ source, event } satisfies EventEnvelope), headers: { 'x-correlation-id': String(event.payload.correlationId ?? event.id) } }] });
          sent = true;
        } catch (error) { console.error('outbox-publish-failed', source, event.id, error); await activeProducer.disconnect().catch(() => undefined); producer = null; }
        await repository.completeOutbox(event.id, sent);
      }
    } catch (error) { console.error('outbox-pump-failed', source, error); }
    finally { running = false; }
  };
  void pump();
  const timer = setInterval(() => { void pump(); }, Math.max(250, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000)));
  return async () => { closed = true; clearInterval(timer); while (running) await new Promise((resolve) => setTimeout(resolve, 25)); await producer?.disconnect(); };
}

export async function startEventConsumer(groupId: string, handler: (envelope: EventEnvelope) => Promise<void>): Promise<() => Promise<void>> {
  let consumer: Consumer | null = null;
  let connecting = false;
  let closed = false;
  const connect = async () => {
    if (closed || connecting || consumer) return;
    connecting = true;
    const candidate = client(`schoolconnect-${groupId}`).consumer({ groupId, allowAutoTopicCreation: false });
    try {
      await candidate.connect();
      await candidate.subscribe({ topic: topic(), fromBeginning: true });
      consumer = candidate;
      void candidate.run({ eachMessage: async ({ message, heartbeat }) => {
        if (!message.value) throw new Error('KAFKA_EMPTY_MESSAGE');
        await handler(parseEventEnvelope(message.value.toString('utf8')));
        await heartbeat();
      } }).catch(async (error) => {
        console.error('kafka-consumer-stopped', groupId, error);
        consumer = null;
        await candidate.disconnect().catch(() => undefined);
      });
    } catch (error) {
      console.error('kafka-consumer-connect-failed', groupId, error);
      await candidate.disconnect().catch(() => undefined);
    } finally { connecting = false; }
  };
  void connect();
  const timer = setInterval(() => { void connect(); }, 5_000);
  return async () => { closed = true; clearInterval(timer); await consumer?.disconnect(); };
}
