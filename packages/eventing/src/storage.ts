import { randomUUID } from 'node:crypto';
import type { EventEnvelope, OutboxEvent } from './index';

// Structural interface keeps the transport package independent of a specific ORM.
export type EventDatabase = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
export type KafkaRecord = { topic: string; partition: number; offset: string; value: Buffer | null; key?: Buffer | null };
export type FailureStore = { quarantine(record: KafkaRecord, errorCode: string, attempts: number, envelope?: EventEnvelope): Promise<unknown> };
export class EventReplayError extends Error {}

export function eventErrorCode(error: unknown): string {
  // Never store/log arbitrary error messages: DB/HTTP errors can contain private data.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) :
    error instanceof Error && /^[A-Z][A-Z0-9_]{2,99}$/.test(error.message) ? error.message : 'EVENT_PROCESSING_FAILED';
  return /^[A-Z0-9_]{2,100}$/.test(code) ? code : 'EVENT_PROCESSING_FAILED';
}

export class PgOutbox {
  constructor(private readonly db: EventDatabase) {}
  async claim(limit: number): Promise<OutboxEvent[]> {
    const result = await this.db.query(`UPDATE outbox_events SET attempt_count=attempt_count+1,
      claim_token=gen_random_uuid(),last_attempt_at=now(),available_at=now()+interval '120 seconds'
      WHERE id IN (SELECT id FROM outbox_events WHERE processed_at IS NULL AND available_at<=now()
        ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT $1)
      RETURNING id,event_type AS "eventType",aggregate_id AS "aggregateId",payload,
        occurred_at AS "occurredAt",claim_token AS "claimToken",attempt_count AS "attemptCount"`,
    [Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit),1),100) : 25]);
    return result.rows as OutboxEvent[];
  }
  async renew(id: string, claimToken: string) {
    const result = await this.db.query(`UPDATE outbox_events SET available_at=now()+interval '120 seconds'
      WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL AND available_at>now()`, [id,claimToken]);
    return result.rowCount === 1;
  }
  async complete(id: string, success: boolean, claimToken?: string, errorCode?: string) {
    if (!claimToken) return { completed:false };
    const result = await this.db.query(success
      ? `UPDATE outbox_events SET processed_at=now(),claim_token=NULL,last_error_code=NULL WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL`
      : `UPDATE outbox_events SET available_at=now()+interval '1 minute',claim_token=NULL,last_error_code=$3 WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL`,
    success ? [id,claimToken] : [id,claimToken,errorCode ?? 'KAFKA_PUBLISH_FAILED']);
    return { completed:success && result.rowCount === 1, updated:result.rowCount === 1 };
  }
  async status() {
    const result = await this.db.query(`SELECT count(*)::int AS pending,
      count(*) FILTER (WHERE last_error_code IS NOT NULL)::int AS failed,
      count(*) FILTER (WHERE claim_token IS NOT NULL AND available_at>now())::int AS leased,
      min(occurred_at) AS "oldestPendingAt",max(attempt_count)::int AS "maxAttempts"
      FROM outbox_events WHERE processed_at IS NULL`);
    const failures=await this.db.query(`SELECT id,event_type AS "eventType",payload->>'schoolId' AS "schoolId",
      attempt_count AS "attemptCount",last_error_code AS "lastErrorCode",last_attempt_at AS "lastAttemptAt",
      occurred_at AS "occurredAt",available_at AS "nextAttemptAt"
      FROM outbox_events WHERE processed_at IS NULL AND last_error_code IS NOT NULL
      ORDER BY occurred_at,id LIMIT 50`);
    return {...result.rows[0],failedEvents:failures.rows};
  }
}

export class PgConsumerFailures implements FailureStore {
  constructor(private readonly db: EventDatabase, readonly groupId: string) {}
  async quarantine(record: KafkaRecord, errorCode: string, attempts: number, envelope?: EventEnvelope) {
    const schoolId = String(envelope?.event.payload.schoolId ?? '');
    // Exact raw bytes are kept privately for replay, never returned by list().
    return this.db.query(`INSERT INTO consumer_failures
      (consumer_group,topic,partition_id,kafka_offset,raw_value,raw_key,error_code,attempt_count,event_id,event_type,school_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (consumer_group,topic,partition_id,kafka_offset) DO UPDATE
      SET last_failed_at=now(),attempt_count=consumer_failures.attempt_count+excluded.attempt_count,error_code=excluded.error_code`,
    [this.groupId,record.topic,record.partition,record.offset,record.value,record.key ?? null,errorCode,attempts,
      envelope?.event.id ?? null,envelope?.event.eventType ?? null,/^[0-9a-f-]{36}$/i.test(schoolId) ? schoolId : null]);
  }
  async list() {
    const result = await this.db.query(`SELECT id,consumer_group AS "consumerGroup",topic,partition_id AS "partition",
      kafka_offset::text AS "offset",event_id AS "eventId",event_type AS "eventType",school_id AS "schoolId",
      state,error_code AS "errorCode",attempt_count AS "attemptCount",replay_count AS "replayCount",
      first_failed_at AS "firstFailedAt",last_failed_at AS "lastFailedAt",resolved_at AS "resolvedAt",
      replayed_by_user_id AS "replayedByUserId"
      FROM consumer_failures WHERE consumer_group=$1 ORDER BY (state='RESOLVED'),last_failed_at DESC,id DESC LIMIT 50`, [this.groupId]);
    return result.rows;
  }
  async counts() {
    return (await this.db.query(`SELECT state,count(*)::int AS count FROM consumer_failures
      WHERE consumer_group=$1 GROUP BY state`, [this.groupId])).rows;
  }
  async replay(id: string, actorUserId: string, handler: (raw: string) => Promise<void>) {
    const token = randomUUID();
    const claimed = await this.db.query(`UPDATE consumer_failures SET state='REPLAYING',replay_token=$3,
      replay_lease_until=now()+interval '5 minutes',replay_count=replay_count+1,replayed_by_user_id=$4
      WHERE id=$1 AND consumer_group=$2 AND (state='QUARANTINED' OR (state='REPLAYING' AND replay_lease_until<now()))
      RETURNING raw_value`, [id,this.groupId,token,actorUserId]);
    if (!claimed.rowCount) {
      const found = await this.db.query('SELECT state FROM consumer_failures WHERE id=$1 AND consumer_group=$2', [id,this.groupId]);
      if (!found.rowCount) throw new EventReplayError('EVENT_FAILURE_NOT_FOUND');
      throw new EventReplayError('EVENT_REPLAY_BUSY_OR_RESOLVED');
    }
    try {
      const raw = claimed.rows[0]?.raw_value;
      if (!Buffer.isBuffer(raw)) throw new Error('KAFKA_EMPTY_MESSAGE');
      await handler(raw.toString('utf8'));
    } catch (error) {
      await this.db.query(`UPDATE consumer_failures SET state='QUARANTINED',replay_token=NULL,
        replay_lease_until=NULL,error_code=$3,last_failed_at=now() WHERE id=$1 AND replay_token=$2`, [id,token,eventErrorCode(error)]);
      return { id,state:'QUARANTINED',errorCode:eventErrorCode(error) };
    }
    // If this update fails after handler commit, the lease expires and replay is
    // safe because each domain handler's effects are durably idempotent.
    const resolved = await this.db.query(`UPDATE consumer_failures SET state='RESOLVED',resolved_at=now(),
      replay_token=NULL,replay_lease_until=NULL WHERE id=$1 AND replay_token=$2`, [id,token]);
    if (resolved.rowCount !== 1) throw new EventReplayError('EVENT_REPLAY_LEASE_LOST');
    return { id,state:'RESOLVED' };
  }
}
