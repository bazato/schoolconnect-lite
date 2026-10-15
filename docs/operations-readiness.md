# Operational monitoring and release handoff

This is a runbook, not a claim that alerts or continuous monitoring have been provisioned. Current execution evidence and blockers are in [the dated release gate](release-readiness-2026-10-15.md).

## Signals and response

| Signal | Suggested initial alert policy (approve against actual staging SLO) | Response |
| --- | --- | --- |
| HTTPS readiness | Consecutive failures beyond the agreed free-host cold-start grace period | Check Render deployment/logs, downstream reachability and Kafka transport state; do not redeploy repeatedly without a cause. |
| API error/latency | Error ratio and p95 over a sustained window, with minimum traffic | Identify endpoint/status/trace correlation, profile service/DB waits; do not remove school/guardian authorization to gain speed. |
| Memory/CPU | Sustained utilization near configured limits | Compare with workload and event fanout; investigate leaks/queues before considering a paid change. |
| Outbox | Oldest pending event age and failed attempts increasing | Check producer auth/TLS/network and broker health; let durable retry recover, do not delete pending rows. Polling remains 2 seconds. |
| Quarantine | New unresolved consumer failures | Owner inspects safe failure metadata; repair cause and replay original stored bytes; do not republish blindly to all groups. |
| Kafka lag | Broker partition high-water offset minus each group's committed offset, growing across observations | Confirm consumer group membership, processing and database availability; investigate before broker retention expires. |
| Backup | Missed backup, expired recovery window or failed restore drill | Repair backup destination/credentials and verify an isolated restore; preserve current production data. |
| File processing/storage | Scanning failures, stuck quarantine, capacity near enforced budget | Keep unscanned files inaccessible, investigate scanner, reconcile reservations and orphan records. Budget alerts alone are not spending caps. |

Do not install a scheduled health check that repeatedly wakes a free service without the owner's consent; it can change free-compute consumption. Choose notification recipient, monitoring system, cadence and cost boundaries before provisioning. A timestamped one-time metric sample does not establish availability or capacity.

## Owner diagnostics after deployment

- `GET /api/v1/admin/operations/events` is restricted by central policy to the platform owner by default. It exposes safe outbox and consumer-failure metadata, not raw event bytes or document URLs.
- `POST /api/v1/admin/operations/events/{service}/{failureId}/retry` replays only the chosen Notifications/Audit/Read consumer's original stored bytes. Wait for final state after a gateway timeout before retrying. A five-minute replay lease fences concurrent operators.
- Process connection snapshots are not Kafka lag. Read broker offsets using a protected operational client, not a public unauthenticated metrics endpoint. Keep 64-bit offsets as strings/BigInt.
- Never log JWTs, OTPs, passcodes, phone/student data, S3 credentials, presigned URLs or database connection strings. Treat quarantine raw bytes as private school data with an approved retention/backup policy.

## Release and rollback checklist

1. Record commit/image, dependency findings, migration plan, expected configuration and signed-artifact fingerprint.
2. Back up the nine databases and demonstrate a restore. Rehearse schema changes and runtime on an isolated environment.
3. Confirm the scanner, file quotas/privacy rules, authorization, mocked-vs-live OTP boundary and permanent signing identity.
4. Deploy the approved code/config together after schema readiness passes. Environment updates through the current Render connector automatically trigger deployments.
5. Verify deployment SHA, HTTPS readiness, role-specific functional tests, load SLO, Kafka lag/outbox/quarantine and alert delivery. Include mobile physical-device and browser CORS tests.
6. If rollout fails, restore the prior code/config together while keeping additive schema and the current Neon data. Do not roll back to the old Render database without reconciling later Neon writes. Do not drop recovery records or reset Kafka offsets to hide failures.

Mock OTP bypasses proof of phone ownership, including recovery. Production-mode code with a trial exception remains a synthetic-data trial, not secure real-school production.
