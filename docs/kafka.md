# Kafka event transport

Kafka is required for asynchronous notifications, audit delivery and read-model projections. There is no standalone worker service. Identity, School, Content, Attendance, Files and Notifications each run an in-process publisher for their own transactional outbox. A publisher retries pending rows until Kafka acknowledges them. Notifications, Audit and Read Model run independent consumer groups and apply events idempotently.

This is **not** a synchronous database-to-Kafka dual write: the owning database transaction commits first, and the publisher sends it afterward. Thus Kafka outages do not lose accepted writes, but downstream views can lag. The mobile app never connects to Kafka; it reads the gateway/API, which reads the resulting projections or in-app inbox.

## Local development

1. Start Docker Desktop, then run `pnpm infra:up` and `pnpm infra:broker:up`.
2. Run `pnpm db:migrate` and `pnpm db:verify`.
3. Use `KAFKA_BROKERS=127.0.0.1:9092`; on a fresh broker set `KAFKA_CREATE_TOPIC=true` for startup, or create `schoolconnect.domain-events.v1` ahead of time. Run `pnpm dev:services`.
4. Run `pnpm test:integration` and `pnpm test:product` against the public gateway. The tests account for eventual-consistency delays.

The Compose broker is a one-node, loopback-only development instance, not a production Kafka cluster. The local PostgreSQL volume may predate the new read database; `pnpm db:migrate` creates and migrates it. Migration `101-read-model-backfill.sql` creates deterministic snapshot events for existing posts and current attendance so the Read Model can catch up.

## Remote deployment

Provision a Kafka broker reachable by every publishing/consuming service and configure `KAFKA_BROKERS`, `KAFKA_EVENT_TOPIC`, `KAFKA_SSL`, and, if applicable, `KAFKA_SASL_MECHANISM`, `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD`. SASL requires TLS in this client. For a broker using a private CA (including Aiven's project CA), set `KAFKA_CA_CERT_BASE64` to the base64-encoded PEM CA certificate; leave it unset when the broker presents a publicly trusted certificate. Precreate a suitably partitioned/replicated topic and set `KAFKA_CREATE_TOPIC=false` for managed brokers. Aiven Free allows at most two partitions per topic, so the local three-partition default must not be used there. Restrict access to the topic because payloads carry student and attendance identifiers.

An environment without Kafka is **not ready for this version**. The earlier database-mode worker fallback has been removed. The old Render/Railway trial manifests must be updated with a broker before deployment. If a publisher or consumer is offline, track outbox age and consumer lag; the process retries on recovery. A permanently failing event currently blocks its partition: dead-letter handling, lag alerts, backpressure limits and recovery runbooks remain production work.
