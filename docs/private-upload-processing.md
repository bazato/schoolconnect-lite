# Private document uploads — implementation and release gate

Status: implemented locally, NOT deployed or enabled on Render. A production-capable scanner host/provider and real-engine + R2 acceptance tests are still required. Mock OTP remains unchanged; this is still a trial, not a production approval.

## Processing flow

1. The authenticated teacher asks the gateway to create an upload. The gateway binds school and uploader from the verified session.
2. Files verifies scanner readiness and reserves twice the file size (quarantine + private copy) in a short transaction protected by a quota advisory lock. Policy is PDF/JPEG/PNG, maximum original upload **5,000,000 bytes (5 MB)**. A five-minute, create-only signed PUT URL targets a server-generated quarantine key.
3. The client uploads binary bytes and requests completion. Files acquires a five-minute processing lease, allowing at most one active check across service instances to bound parser memory/CPU. No database connection stays open while reading/scanning/writing objects.
4. Files reads bounded bytes, verifies actual length and original SHA-256 and checks the declared file signature/basic structure. Images get format-preserving optimization, bounded to 16 million input pixels and a minimum 1600px long-edge for large inputs. Small originals are never enlarged. PNG alpha is retained and ancillary metadata stripped on re-encoding. PDFs above 250 KB get lossless unfiltered-stream compression plus an object-stream rewrite, preserving pages/text rather than rasterizing them. Signed PDFs are left unchanged or rejected if too large, never rewritten; signature fields inside compressed PDF objects are also checked. Any output must be at most **3,400,000 bytes (3.4 MB)**. Compression is best-effort, not guaranteed; an uncompressible file is rejected with a clear error, not truncated or sent oversized to the scanner. This is NOT full PDF sanitization or CDR.
5. A real ClamAV adapter streams the final optimized bytes for malware scanning. A fresh signature version and successful EICAR self-test are required. Unavailable, timed-out, stale or ambiguous scanners fail closed. Cloudmersive is a proposed alternative but NOT yet integrated; no documents have been sent to it. The conservative output target leaves headroom below its advertised 3.5 MB evaluation limit and does not raise its monthly request allowance.
6. The SAME checked bytes are PUT to a different immutable private key. There is no scan-then-copy of a client-writable object. An existing retry object must match the bytes exactly.
7. A single transaction commits READY, checksum/scan attestation and the `fileUploadCompleted` outbox event. The existing outbox publisher sends it to Kafka. No separate worker or scan-consumer service was added; the existing two-second outbox schedule was not changed.
8. Before publication, the gateway verifies every attachment is READY and belongs to that teacher and school. Existing post/guardian-child authorization remains necessary for download. The Files service accepts access decisions only from authenticated internal callers. Download URLs last 60 seconds and are private/no-store.

## Recovery and resource limits

- Completed sessions are idempotent, including when the client lost the response. Uploader and school are checked even on READY retries.
- Transient failures release the processing lease and retain the quarantine object for retry. Permanent checksum/type/malware failures are rejected. Processing is limited to ten attempts and a 24-hour recovery window.
- Mobile same-process retries retain only upload identifiers and do not repeat a successful PUT. This is not durable cross-restart upload resumption; abandoned uploads are cleaned server-side.
- A five-minute housekeeping timer in the existing Files process deletes expired/unneeded quarantine objects in bounded batches. It is not another worker service or the scan trigger. It waits beyond signed-PUT expiry and active processing leases. Failed deletes retain their quota reservation for retry.
- READY private objects are retained; housekeeping deletes only their quarantine copy. An explicit product retention/deletion policy for published private documents remains a separate decision.
- Application-managed storage caps are configurable: `FILE_STORAGE_BUDGET_BYTES` and `FILE_SCHOOL_BUDGET_BYTES`. Suggested conservative trial values are 8000000000 and 2000000000 respectively. These are not an R2 billing cap and cannot limit manual uploads, unrelated buckets, provider request charges, or other clients holding bucket credentials.
- Migration 109 stores `stored_byte_size`, `stored_checksum_sha256` and `compression_method` separately from the original upload's size/hash. `verified_checksum_sha256` attests the FINAL stored bytes. Reservations decrease to original+optimized size on READY and to optimized size after quarantine cleanup. Retries reuse a versioned, immutable destination and cannot substitute different bytes there.
- Untrusted image/PDF parsing runs in a short-lived child process with a 96 MB V8 heap limit, 20-second wall deadline, no inherited application secrets, one native image thread and disabled image cache. This is resource isolation, NOT a complete OS sandbox; native decoder memory is additionally constrained by pixel/channel bounds. No separate persistent worker service is added. Production-host peak-memory verification is still required before rollout.
- Legacy READY rows without a verified checksum and scan attestation cannot be downloaded or attached through the new checks. Re-upload/rescan them using the real pipeline; do not backfill fake attestations.

## Scanner options implemented

- `FILE_SCANNER_PROVIDER=clamd`: loopback/private co-located ClamAV TCP, default port 3310. Anonymous remote TCP is rejected in production.
- `FILE_SCANNER_PROVIDER=clamav-http`: an operator-controlled HTTPS gateway, authenticated with an independent random secret in `FILE_SCANNER_TOKEN`. `FILE_SCANNER_URL` must be HTTPS, without embedded credentials/query/fragment. The adapter verifies an explicit clean verdict and SHA-256 attestation for the submitted bytes.
- `scripts/clamav-gateway.mjs` provides the private HTTP-to-ClamAV adapter. It binds ONLY to 127.0.0.1:3311, authenticates health and scan requests, limits body size/concurrency and never logs document contents. Build Files first, then run `pnpm scanner:gateway` with the token supplied privately in the environment. Do not expose port 3310 publicly. Any remote HTTPS/authenticated network setup needs a separately approved hosting configuration.
- `FILE_SIGNATURE_MAX_AGE_HOURS` defaults to 72 (maximum 168); `FILE_SCAN_TIMEOUT_MS` defaults to 40000 (maximum 60000). The engine also needs regular automatic signature updates. No fake-clean adapter is permitted in production.
- Cloudmersive or other hosted providers have NOT been integrated or authorized to receive school documents. Such an integration must review terms, privacy/data residency, file size, request quotas and failure behavior first.

ClamAV's documented Docker minimum is 3 GiB, preferred 4 GiB: https://docs.clamav.net/manual/Installing/Docker.html . This cannot be added safely to the existing 512 MB free Render API instance. The local Docker allocation was also insufficient alongside existing trial containers; no containers were stopped or scanners provisioned.

## Deployment checklist (not performed)

1. Agree on scanner hosting/provider and any third-party document processing. Do not silently add a paid service or keep a personal computer as a production dependency.
2. Provision/update the actual engine, exercise healthy, EICAR/infected, stale-definition and outage cases. A no-op/fake daemon does not satisfy this acceptance step.
3. Rehearse migrations `108-secure-file-processing.sql` and `109-compressed-private-files.sql` on an isolated Neon branch, then apply through the protected direct migration connection. The managed runtime schema gate requires all versioned migrations, including pending migration 107 from the earlier product work. Do not use runtime credentials for DDL.
4. Preserve existing database/JWT/passcode/Kafka/OTP settings. Add explicit storage budgets, scanner endpoint/secret, S3 credentials, bucket/region/endpoint in protected server configuration. Never put them in Git or public mobile environment variables.
5. Verify the R2 bucket is private and configure narrowly scoped browser PUT CORS for approved origins/headers, including Content-Type, If-None-Match and checksum metadata. Native clients do not use browser CORS. Do not enable public r2.dev access.
6. Deploy with uploads still disabled, perform a real R2/scanner integration test on synthetic documents, inspect READY/outbox delivery and authorization/cleanup behavior, then enable the capability.
7. Build/test a new signed APK for the mobile retry/timeout changes. No APK or cloud deployment was produced by this implementation task.

## Reproducible local checks

- `pnpm --filter @schoolconnect/files test`: scanner wire-protocol tests use an explicit fake daemon; validates parser/timeout/self-test rejection logic, not real signature detection.
- `pnpm test:scanner:gateway`: HTTP authentication, size/concurrency limits and clean/rejected/error response contracts, with a test scanner.
- `pnpm test:files:db`: creates a uniquely named local disposable PostgreSQL database, applies Files schema + migration 108 and tests transactions, quotas, authorization, recovery and source substitution with storage/scanner test doubles. Only the generated test database is removed afterward.
- `pnpm --filter @schoolconnect/api test`, `pnpm --filter @schoolconnect/mobile test`, contracts tests, typecheck/lint/build and managed-runtime migration checks cover the affected boundaries.

Skills used: Cloudflare guidance informed private immutable R2 handling; Render deployment/Docker guidance informed the scanner hosting boundary; Neon guidance kept schema tests isolated and migration-based rather than changing production data during implementation.

### Compression verification (2026-10-17)

- Files: 38 passing tests, including actual Sharp JPEG/PNG processing, real pdf-lib PDF compression/page/data preservation, compressed-object signature detection, and incompressible/oversize/malformed inputs.
- Disposable PostgreSQL integration: 22 passing scenarios. Includes final compressed-byte scan/storage, separate original/stored hashes and quota accounting, deterministic retries, and rejection before scan/publication when the target cannot be met. Storage and malware scanner remain explicit test doubles.
- Mobile: 91 passing tests; typecheck and lint passed. Files build and lint passed. Managed runtime/migration checks: 15 passed.
- No live R2/scanner acceptance, hosted-provider integration, deployment, physical-device acceptance or new APK was completed. No application databases were modified; only generated disposable test databases were created and removed.
