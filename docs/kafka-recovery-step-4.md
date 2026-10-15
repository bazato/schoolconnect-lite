# Kafka recovery: production checklist step 4

Implemented locally on 2026-10-14. Not committed, pushed, migrated on Neon or deployed. No extra worker, broker or paid resource was created. Mock OTP and the configured 2,000 ms outbox polling interval are unchanged.

## Flow and delivery guarantees

1. A service commits its business change and outbox row in the same PostgreSQL transaction, as before.
2. Its in-process publisher claims pending rows with `FOR UPDATE SKIP LOCKED`. Each claim gets a new UUID token and a 120-second lease. Before sending each row, the publisher renews that still-owned, unexpired lease. A stale publisher cannot complete a reclaimed row.
3. Kafka must acknowledge the publish (`acks: -1`) before the matching token may mark the outbox row processed. Claim tokens are not included in Kafka envelopes. If Kafka acknowledges but the database completion fails, the lease expires and the event is delivered again: consumers must remain idempotent.
4. A send failure disconnects that producer. Remaining claimed rows are released for retry instead of sent through a dead connection. Pending failed rows retain a safe error code and retry after one minute, preserving the previous retry delay; the publisher still checks every two seconds.
5. Notifications, Audit and Read Model retain their existing independent consumer group IDs. KafkaJS restarting crashes recover through its own machinery; non-restarting crashes clear the client after disconnect so the five-second reconnect check can create a new consumer.
6. Handler failures get at most three attempts, one second apart by default. Heartbeats continue during slow processing and retries. Malformed envelopes are not retried because identical bytes will still be malformed.
7. After bounded retries, the consumer writes the exact raw message bytes and Kafka coordinates to **its own database's** `consumer_failures` table. Only after that write succeeds does its Kafka handler return and permit the normal KafkaJS offset advancement. If that write fails, the handler throws; Kafka must redeliver the message. Nothing is silently acknowledged and discarded.
8. The partition may then process later messages. The failed notification/audit/projection is still missing until an owner repairs the cause and replays it. Quarantine deliberately trades strict business-effect ordering for continued partition progress; it is not equivalent to successful delivery.

These semantics follow KafkaJS's documented [message processing/offset behavior](https://kafka.js.org/docs/consuming) and [CRASH instrumentation](https://kafka.js.org/docs/instrumentation-events). Kafka retention is finite: monitor lag and recover before retained broker records expire. This is at-least-once delivery with idempotent database effects, not an end-to-end exactly-once promise.

## Duplicate and replay safety

- Notifications retain their event/recipient/student uniqueness constraint. Inbox insert, in-app delivery attempt and notification outbox insert commit together. Fanout waits for **all** started writes to settle before reporting a failure; replay fills missing recipients without repeating successful inbox effects.
- Audit retains its `(source_event_id, action)` uniqueness constraint.
- Read Model's `consumed_events` receipt and projection mutation commit in one transaction; a projection failure rolls both back. Duplicate event IDs do not repeat effects.
- Older post revisions cannot overwrite newer revisions. Archived posts are terminal in the projection. New archive receipts retain school and aggregate metadata, so an older quarantined publish cannot resurrect a post even when archive arrived before the post existed.
- Quarantine is unique by consumer group/topic/partition/offset; Kafka offsets remain 64-bit strings in diagnostics, never JavaScript numbers.
- Manual replay has a fenced five-minute lease. Concurrent replay attempts conflict. A successful handler marks the record resolved; a failed handler returns it to quarantine with a safe code. If the process dies or resolution fails after the handler commit, retry is safe after lease expiry because of the handlers' durable idempotency.
- Replay uses the **original stored bytes** in only the chosen consumer. It does not republish the record to every Kafka group and does not accept a replacement payload supplied by the caller. Truly malformed original bytes may remain unreplayable; do not delete or silently dismiss them as delivered.

## Owner-only operational APIs

| Public gateway API | Purpose |
| --- | --- |
| `GET /api/v1/admin/operations/events` | Per-service connection snapshots, oldest pending outbox time, attempt/error counts, failed publisher row metadata, consumer failure counts and up to 50 recent failure summaries. Active quarantines/replays are ordered ahead of resolved history. |
| `POST /api/v1/admin/operations/events/{service}/{failureId}/retry` | Replay a stored failure owned by `notifications`, `audit` or `read`. |

Authorization for these routes is in the configurable central policy service, defaulting to `PLATFORM_OWNER` only. School administrators, teachers and parents are denied. Gateway destination whitelisting and UUID validation prevent arbitrary service/path routing. The replay actor comes from the owner session, not a caller-supplied actor field.
If an environment supplies a custom `AUTHORIZATION_ROUTE_RULES_JSON`, its operator must explicitly add the two owner-only rules there; the application does not overwrite custom policy configuration.

Internal diagnostics/replay endpoints remain behind the internal service token and loopback/private service boundary. Diagnostics exclude raw message bytes, raw keys, notification bodies, student names and arbitrary exception messages. Raw failure bytes are private database records and may contain school/child data; include them in the database protection/backup/retention policy. Replay actor, count and timestamps are recorded locally. No separate browser operations screen was added.

Runtime connection flags are last-observed process state, not a broker-side consumer-lag measurement. Quarantine/error counters in those snapshots reset on process restart; database failure records/counts and outbox attempts persist. Service readiness now becomes degraded when a required transport reports disconnected. A producer may not notice an idle broker disconnection until its next send; readiness does not prove delivery or zero lag. A quarantine does not make the entire API unavailable, but it requires operator attention.

The gateway has a five-second downstream timeout. A large replay can continue after an HTTP timeout; check diagnostics before retrying, and do not interpret the timeout as a confirmed replay failure. The lease prevents another replay while the first is active. Allow enough operational time for fanout and inspect final record state.

## Configuration and shutdown

| Setting | Default / current behavior |
| --- | --- |
| `OUTBOX_POLL_INTERVAL_MS` | 2000; unchanged |
| `KAFKA_HANDLER_MAX_ATTEMPTS` | 3; bounded 1–10 |
| `KAFKA_HANDLER_RETRY_DELAY_MS` | 1000; bounded 1–5000 |
| Outbox lease | 120 seconds, refreshed before each send |
| Publisher failure retry | One minute |
| Consumer reconnect check | Five seconds |
| Manual replay lease | Five minutes |

All Nest applications now use a single shared SIGTERM/SIGINT shutdown registry when bundled in one process, rather than competing signal handlers. Shutdown closes/drains the gateway first, then drains all Kafka processing while internal HTTP services and their databases are still open, and only then closes those services/pools. Each owner's cleanup also drains its publisher/consumer before closing its pool. Independent service processes use the same lifecycle. The existing scheduled-publishing component keeps its Nest cleanup hook. Forced termination can still interrupt work; database rollback, expired leases and consumer deduplication are the recovery mechanism.

No Render configuration was applied. Check the actual platform shutdown window and worst-case handler duration before a production deployment; a short platform window can cause redelivery rather than a clean drain.

## Additive migration and release sequence

`infra/postgres/init/104-event-recovery.sql` has ten service-owned segments:

- Seven existing outbox tables gain `claim_token`, `last_attempt_at`, and `last_error_code` (Identity, School, Content, Attendance, Files, Notifications, Fees).
- Three independent `consumer_failures` tables are added (Notifications, Audit, Read).
- Existing Read `consumed_events` gains school/aggregate metadata and its lookup index.

No cross-database foreign key or shared domain-data ownership is introduced. Existing records remain in place. Legacy internal outbox completion callers must pass the returned claim token and explicit `success: true`; id-only completion is refused.

1. Back up and test the additive migration in an isolated database/Neon test branch using a **direct** connection. Do not test with live school records.
2. Review `pnpm db:managed:plan`, then apply through the protected operator-only migration workflow described in [production runtime](production-runtime.md). Do not copy a migration credential into the application's runtime environment. No migration was applied by this implementation task.
3. Deploy all changed services together only after migration. The managed startup gate requires the new migration ledger entries and consumer tables. Merely deploying the new code against the old schema is not safe.
4. Verify every existing consumer group joins, readiness recovers, and owner diagnostics show no unexplained pending backlog/quarantines.
5. Run the acceptance checks below. Preserve the additive schema during a code rollback; do not destructively drop recovery records or reset Kafka group offsets.

## Verified locally and outstanding acceptance

The automated workspace run passed **366 tests**, and a subsequently added shutdown-order test passed in the affected suite (**367 passing tests total**). **21 database cases are skipped** (14 pre-existing plus the new seven-case recovery suite). Runtime/migration-script tests passed **10**. Lint, typechecking, builds, frozen-lockfile compatibility and migration planning passed. The PostgreSQL recovery integration suite is opt-in and has **not run**.

The new seven-case suite exercises real transactional receipt rollback, duplicate delivery, older-revision replay, archive-before-publish replay, expired outbox token fencing, quarantine offset precision and concurrent replay ownership. It refuses non-local hosts and any database other than `schoolconnect_eventing_test`, uses a unique synthetic schema and cleans up only that exact schema. Run it after creating that isolated local database:

```powershell
$env:EVENTING_DB_TEST_URL = 'postgresql://schoolconnect:schoolconnect@127.0.0.1:5432/schoolconnect_eventing_test'
pnpm --filter @schoolconnect/read-model test
```

Use the actual protected local password if it differs; never paste a live database URL into this command. Docker Desktop accepted a start request, but Docker API commands hung and localhost PostgreSQL was not listening. Therefore SQL execution against PostgreSQL, live broker recovery, migration application and on-host signal handling remain unverified.

Before release, run these tests against an isolated real stack:

1. Stop Kafka, publish a synthetic announcement, confirm the business transaction/outbox persists, restore Kafka and confirm the parent inbox/timeline catches up once.
2. Interrupt outbox completion after Kafka ACK; confirm redelivery does not duplicate inbox, audit or projection effects.
3. Inject a malformed test record; confirm only the failing group's private quarantine is retained and the next record progresses. Make the quarantine database unavailable and confirm its offset is **not** advanced.
4. Fail one recipient write; restore it and replay that group's record, confirming existing successful recipients are not duplicated.
5. Crash/restart a consumer, replay concurrently and stop during in-flight processing; confirm leases and offsets recover as documented.
6. Verify an older failed publish replay cannot resurrect an archived post and an older revision cannot overwrite a newer one.

Automatic alerts, broker-side consumer-lag dashboards, pending-backlog capacity limits, recovery-data retention/archival policy and a production failure-injection rehearsal remain operations work. Quarantine storage can grow until an explicit retention policy is approved; nothing is automatically purged. Mock OTP still makes this synthetic-data trial configuration, not a secure real-school production release.

Next proposed checklist step: private Cloudflare R2 attachments plus a genuine malware scanner. That step and any push/deployment require separate approval.
