// Failure injection is confined to the explicitly named disposable local broker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { testSignIn } from './test-sign-in.mjs';
const require = createRequire(new URL('../services/identity/package.json', import.meta.url));
const { Pool } = require('pg');
const requireEventing = createRequire(new URL('../packages/eventing/package.json', import.meta.url));
const { Kafka, logLevel } = requireEventing('kafkajs');
const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:3390/api/v1';
assert.equal(base, 'http://127.0.0.1:3390/api/v1', 'ISOLATED_RELEASE_API_REQUIRED');
const broker = 'nexqon-release-acceptance-kafka-1';
const project = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', broker], { encoding: 'utf8', timeout: 10000 }).trim();
assert.equal(project, 'nexqon-release-acceptance');
const topic = 'nexqon-release-acceptance';
const pools = ['content', 'read', 'notifications', 'audit'].map((name) => new Pool({ connectionString: `postgresql://schoolconnect:schoolconnect-release-test-only@127.0.0.1:55432/schoolconnect_${name}`, connectionTimeoutMillis: 3000, max: 2 }));
const call = async (path, token, body) => {
  const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
};
const eventually = async (check, timeout = 30000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('KAFKA_ACCEPTANCE_TIMEOUT');
};
const suffix = String(Date.now()).slice(-8);
const login = (phone, invite) => testSignIn(base, phone, invite, `kafka-release-${randomUUID()}`);
let producer;
let brokerAdmin;
let stopped = false;
try {
  const owner = await login('+919876543200', 'OWNER-INVITE');
  const school = await call('/admin/schools', owner.accessToken, { schoolCode: `KT${suffix}`, displayName: 'Isolated Kafka recovery school', timezone: 'Asia/Riyadh', adminDisplayName: 'Synthetic Admin', adminPhoneE164: `+998${suffix}00` });
  const admin = await login(`+998${suffix}00`, school.administrator.invitationCode);
  const c = await call('/admin/classes', admin.accessToken, { classCode: 'KAFKA', displayName: 'Synthetic Kafka Class', academicYear: '2026-2027' });
  const t = await call('/admin/teachers', admin.accessToken, { displayName: 'Synthetic Teacher', phoneE164: `+998${suffix}01`, classId: c.id, subjectCode: 'MATH', subjectName: 'Mathematics', canPublishAnnouncements: true });
  const teacher = await login(`+998${suffix}01`, t.teacher.invitationCode);
  const p = await call('/admin/parents', admin.accessToken, { displayName: 'Synthetic Parent', phoneE164: `+998${suffix}02`, studentDisplayName: 'Synthetic Child', admissionNumber: 'KAFKA-ONLY', classId: c.id });
  const parent = await login(`+998${suffix}02`, p.parent.invitationCode);
  const publish = (title) => call('/posts', teacher.accessToken, { classId: c.id, postType: 'ANNOUNCEMENT', title, body: 'Synthetic failure-injection acceptance only.', audienceType: 'CLASS', idempotencyKey: randomUUID() });
  const visible = async (id) => (await call(`/timeline/${p.student.studentId}`, parent.accessToken)).some((item) => item.id === id);

  console.log('1/4 Stop only the isolated Kafka broker and publish a durable business change.');
  execFileSync('docker', ['stop', '--time', '10', broker], { timeout: 25000, stdio: 'pipe' });
  stopped = true;
  const post = await publish('Published while isolated Kafka is unavailable');
  const pending = await pools[0].query('SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id=$1 AND processed_at IS NULL', [post.id]);
  assert.ok(pending.rows[0].count > 0);
  assert.equal(await visible(post.id), false);

  console.log('2/4 Restart the isolated broker; wait for outbox retry and parent delivery.');
  execFileSync('docker', ['start', broker], { timeout: 15000, stdio: 'pipe' });
  stopped = false;
  await eventually(() => visible(post.id), 120000);
  await eventually(async () => (await pools[0].query('SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id=$1 AND processed_at IS NULL', [post.id])).rows[0].count === 0);

  console.log('3/4 Redeliver the same event and verify projection receipt deduplication.');
  const event = (await pools[0].query('SELECT id,event_type,aggregate_id,payload,occurred_at FROM outbox_events WHERE aggregate_id=$1 ORDER BY occurred_at LIMIT 1', [post.id])).rows[0];
  const envelope = { source: 'content', event: { id: event.id, eventType: event.event_type, aggregateId: event.aggregate_id, payload: event.payload, occurredAt: event.occurred_at.toISOString() } };
  const kafka = new Kafka({ clientId: 'isolated-release-verifier', brokers: ['127.0.0.1:19092'], logLevel: logLevel.NOTHING });
  producer = kafka.producer();
  await producer.connect();
  const duplicate = (await producer.send({ topic, acks: -1, messages: [{ key: `${school.school.id}:${post.id}`, value: JSON.stringify(envelope) }] }))[0];
  brokerAdmin = kafka.admin();
  await brokerAdmin.connect();
  // The original receipt already exists; wait for all groups to commit past the
  // duplicate's actual broker offset before asserting deduplication.
  await eventually(async () => (await Promise.all(['schoolconnect-read-model-v1', 'schoolconnect-notifications-v2', 'schoolconnect-audit-v2'].map(async (groupId) => {
    const offsets = await brokerAdmin.fetchOffsets({ groupId, topics: [topic] });
    const offset = offsets.find((t) => t.topic === topic)?.partitions.find((p) => p.partition === duplicate.partition)?.offset;
    return offset !== undefined && BigInt(offset) > BigInt(duplicate.baseOffset);
  }))).every(Boolean));
  assert.equal((await pools[1].query('SELECT count(*)::int AS count FROM consumed_events WHERE event_id=$1', [event.id])).rows[0].count, 1);
  assert.equal((await pools[2].query('SELECT count(*)::int AS count FROM notifications WHERE source_event_id=$1', [event.id])).rows[0].count, 1);
  assert.equal((await pools[3].query('SELECT count(*)::int AS count FROM audit_events WHERE source_event_id=$1', [event.id])).rows[0].count, 1);

  console.log('4/4 Inject malformed bytes, verify all three quarantines, then verify later valid delivery.');
  const marker = `synthetic-malformed-${randomUUID()}`;
  await producer.send({ topic, acks: -1, messages: [{ key: marker, value: '{invalid synthetic json' }] });
  await eventually(async () => (await Promise.all(pools.slice(1).map(async (pool) => (await pool.query("SELECT count(*)::int AS count FROM consumer_failures WHERE raw_key=$1 AND state='QUARANTINED'", [Buffer.from(marker)])).rows[0].count))).every((n) => n === 1));
  const later = await publish('Valid message following malformed bytes');
  await eventually(() => visible(later.id));
  assert.equal((await pools[1].query('SELECT count(*)::int AS count FROM read_posts WHERE post_id=$1', [post.id])).rows[0].count, 1);
  console.log(JSON.stringify({ scope: 'isolated local broker/database only', durableOutboxDuringOutage: 'passed', restartDelivery: 'passed', duplicateProjection: 'passed', quarantineConsumers: 3, laterValidDelivery: 'passed', originalPollingMs: 2000 }));
} finally {
  if (stopped) execFileSync('docker', ['start', broker], { timeout: 15000, stdio: 'pipe' });
  await producer?.disconnect();
  await brokerAdmin?.disconnect();
  await Promise.all(pools.map((pool) => pool.end()));
}
