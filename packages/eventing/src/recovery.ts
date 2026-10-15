import type { EventEnvelope } from './index';
import { parseEventEnvelope } from './index';
import { eventErrorCode, type FailureStore, type KafkaRecord } from './storage';

export type RecoveryOptions = { failureStore: FailureStore; maxAttempts?: number; retryDelayMs?: number };
export async function consumeWithRecovery(record: KafkaRecord, handler: (event: EventEnvelope) => Promise<void>,
  heartbeat: () => Promise<void>, options: RecoveryOptions) {
  if (!Number.isInteger(options.maxAttempts ?? 3) || (options.maxAttempts ?? 3)<1 || (options.maxAttempts ?? 3)>10 ||
    !Number.isInteger(options.retryDelayMs ?? 1000) || (options.retryDelayMs ?? 1000)<0 || (options.retryDelayMs ?? 1000)>5000) throw new Error('KAFKA_RECOVERY_OPTIONS_INVALID');
  let envelope: EventEnvelope | undefined;
  try {
    if (!record.value) throw new Error('KAFKA_EMPTY_MESSAGE');
    envelope = parseEventEnvelope(record.value.toString('utf8'));
  } catch (error) {
    // A malformed envelope cannot be made valid by retrying the same bytes.
    await options.failureStore.quarantine(record,eventErrorCode(error),1);
    return { quarantined:true };
  }
  const maximum = options.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt=1; attempt<=maximum; attempt++) {
    try { await handler(envelope); return { quarantined:false }; }
    catch (error) { lastError = error; }
    if (attempt<maximum) {
      await heartbeat();
      await new Promise((resolve) => setTimeout(resolve,options.retryDelayMs ?? 1000));
    }
  }
  // Never return success/advance a Kafka offset until the failure record commits.
  // If the failure store is unavailable, this throws and Kafka redelivers.
  await options.failureStore.quarantine(record,eventErrorCode(lastError),maximum,envelope);
  return { quarantined:true };
}
