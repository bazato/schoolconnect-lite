import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from './index';

describe('Kafka event envelope', () => {
  const valid = { source: 'content', event: { id: 'event-1', eventType: 'content.post-published.v1', aggregateId: 'post-1', occurredAt: '2026-10-06T00:00:00.000Z', payload: { schoolId: 'school-1' } } };
  it('accepts a versioned event with its owning source', () => expect(parseEventEnvelope(JSON.stringify(valid))).toEqual(valid));
  it('rejects unknown source and malformed payload', () => {
    expect(() => parseEventEnvelope(JSON.stringify({ ...valid, source: 'other' }))).toThrow('KAFKA_EVENT_SOURCE_INVALID');
    expect(() => parseEventEnvelope(JSON.stringify({ ...valid, event: { ...valid.event, payload: [] } }))).toThrow('KAFKA_EVENT_PAYLOAD_INVALID');
  });
});
