import { describe, expect, it } from 'vitest';
import { kafkaConnectionConfig, parseEventEnvelope } from './index';

describe('Kafka event envelope', () => {
  const valid = { source: 'content', event: { id: 'event-1', eventType: 'content.post-published.v1', aggregateId: 'post-1', occurredAt: '2026-10-06T00:00:00.000Z', payload: { schoolId: 'school-1' } } };
  it('accepts a versioned event with its owning source', () => expect(parseEventEnvelope(JSON.stringify(valid))).toEqual(valid));
  it('rejects unknown source and malformed payload', () => {
    expect(() => parseEventEnvelope(JSON.stringify({ ...valid, source: 'other' }))).toThrow('KAFKA_EVENT_SOURCE_INVALID');
    expect(() => parseEventEnvelope(JSON.stringify({ ...valid, event: { ...valid.event, payload: [] } }))).toThrow('KAFKA_EVENT_PAYLOAD_INVALID');
  });
});

describe('Kafka connection configuration', () => {
  const privateCa = '-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n';
  it('supports a broker with SASL over TLS and a private CA', () => {
    expect(kafkaConnectionConfig({
      KAFKA_BROKERS: 'broker.example:1234',
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'scram-sha-256',
      KAFKA_SASL_USERNAME: 'service-user',
      KAFKA_SASL_PASSWORD: 'secret',
      KAFKA_CA_CERT_BASE64: Buffer.from(privateCa).toString('base64'),
    })).toEqual({
      brokers: ['broker.example:1234'],
      ssl: { ca: [privateCa] },
      sasl: { mechanism: 'scram-sha-256', username: 'service-user', password: 'secret' },
    });
  });
  it('rejects a CA without TLS or a malformed CA', () => {
    expect(() => kafkaConnectionConfig({ KAFKA_BROKERS: 'broker.example:1234', KAFKA_CA_CERT_BASE64: Buffer.from(privateCa).toString('base64') }))
      .toThrow('KAFKA_CA_REQUIRES_TLS');
    expect(() => kafkaConnectionConfig({ KAFKA_BROKERS: 'broker.example:1234', KAFKA_SSL: 'true', KAFKA_CA_CERT_BASE64: Buffer.from('not-a-cert').toString('base64') }))
      .toThrow('KAFKA_CA_CERT_INVALID');
  });
});
