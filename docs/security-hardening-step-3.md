# Production checklist: step 3 security hardening

Date: 2026-10-14. Implemented locally; not committed, pushed or deployed.

## Changes and purpose

- Upgraded all 15 workspace Vitest development dependencies from 3.2.4 to 4.1.11. This removes vulnerable Vitest/mocker versions and their old tinypool dependency chain. Test discovery is explicitly restricted to `src` so built test copies in `dist` are not executed by Vitest 4.
- Added version-selective pnpm overrides for proxy-addr 2.0.8, shell-quote 1.11.0, brace-expansion 1.1.21/5.0.12, source-map-js 1.2.2 and http-cache-semantics 4.3.0. Existing uuid override is retained. Lockfile regenerated; the declared pnpm 10.15.1 accepts a frozen lockfile-only installation.
- Gateway and legacy School authorization adapters require the literal boolean `allowed: true`. Strings, missing fields, numbers, null and negative responses deny access. School must report literal `active: true`.
- Identity session responses are validated before use: safe opaque IDs, recognized role, session ID, display name and school context. Only platform owners can have an unscoped session.
- A gateway transport guard rejects URL delimiters/control characters, structured or repeated scope IDs, and malformed date query values before downstream requests. It accepts UUIDs and existing opaque fixture IDs. Optional null body IDs and free-text questions/names/notes remain supported. This is input validation, not a second role policy engine.
- Parent private-file access checks the live guardian relationship before fetching post details or requesting a private file URL. Content still owns post/audience/file authorization and Files still owns private URL issuance.
- Authorization's live School relationship response is interpreted strictly and consistently; a malformed response can never create a positive policy decision.
- API tests close their Nest applications after each case.

Without these fixes, affected dependency versions remain installed, malformed truthy authorization fields could pass gateway checks, and interpolated IDs/date strings could alter downstream URL queries. The changes remove these specific failure modes; they are not a claim that every production risk is resolved.

## Dependency audit

Full workspace scan, including development dependencies:

| Finding count | Before | After |
| --- | ---: | ---: |
| Critical | 5 | 0 |
| High | 8 | 2 |
| Moderate | 4 | 0 |
| Total | 17 | 2 |

No advisory is ignored or suppressed. `pnpm audit --json` still exits nonzero for the two residual findings:

1. **node-forge 1.4.0**: RSA PKCS#1 v1.5 signature verification issue, [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). The registry audit lists no published patched version. Installed through Expo CLI/code-signing tooling.
2. **braces 3.0.3**: deeply nested glob pattern stack-exhaustion denial of service, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The registry audit lists no published patched version. Installed through React Native/Metro/micromatch tooling.

The backend-only dependency query (`pnpm --filter './services/**' --filter @schoolconnect/contracts --filter @schoolconnect/eventing why node-forge braces`) returns neither package. These paths do not establish a vulnerability in a hosted backend endpoint. Conversely, audit's `dev: false` classification does not establish that Expo CLI code ships in the mobile JS bundle: Expo brings tooling transitively through a runtime package.

Until maintained fixes exist: build only trusted repository inputs, do not accept user-supplied glob patterns in build tooling, do not expose Metro/Expo development servers as production hosting, and do not treat node-forge tooling verification as a trusted production signature-verification boundary. Keep the findings visible; re-audit before a release and update through maintained compatible upstream fixes. No custom cryptographic patch or silent risk exception was introduced.

## Authorization verification

51 additional unit/HTTP-contract cases cover:

- Malformed route decisions, resource decisions, session principals and school state.
- School-scoped guardian facts, foreign student IDs and live assignment/guardian revocation without cached grants.
- Forged school/user/role headers and body/query scope cannot replace Identity's authenticated principal.
- Private file denial occurs before private URL generation and before post-detail fetch on a revoked guardian link.
- Foreign-class publishing/attendance denial before a business write.
- Administrator student edits always use their session school; foreign resources remain not found, with no unscoped retry.
- Downstream School/Authorization failure and revoked sessions fail closed.
- Duplicate/structured IDs and delimiter/date injection are rejected before any downstream call.
- Concurrent HTTP requests retain distinct per-tenant AsyncLocalStorage contexts.
- The real central policy unit tests verify tenant-scoped fact queries, configured role rules, strict facts and unavailable fact service behavior.

Gateway contract tests simulate Identity/Authorization/School/resource stores. They exercise real Nest guards/controllers over HTTP, but do **not** prove actual PostgreSQL row isolation. Source review confirms School's relationship SQL binds school, actor and resource together, and student/class updates include the school predicate. Real multi-school fixture tests, actual session/relationship revocation and private-file storage tests against running services remain acceptance work; source review and mocked tests do not replace them.

## Verification and limitations

- Workspace tests: **330 passed, 14 database integration cases skipped**. School and Read Model currently have no standalone unit test suite; `--passWithNoTests` is not evidence of coverage.
- Managed runtime/demo migration script tests: **10 passed**.
- Workspace lint, TypeScript checks and builds passed (all backend services, web portal and Expo web export).
- Database-backed tests could not run because the Docker Linux engine pipe was unavailable. No hosted Neon test data or configuration was changed.
- Android release-mode JS export passed with source maps and bytecode disabled for inspection. One source map enumerated 2,609 sources; neither node-forge nor braces was present. This is evidence for this Android JS bundle only, not a signed APK release, iOS bundle verification or an on-device test. Keep normal Hermes bytecode enabled for a real release.
- Full audit remains non-clean as explained above. The step is not a production security certification.

Repeat with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:runtime`, `pnpm build`, and `pnpm audit --json`. Use a dedicated isolated local/test database for integration tests, never the live school database.

## Unchanged and next approval

Mock OTP, existing credentials/passcode pepper, two-second outbox polling, Kafka configuration, live Neon/Render services and published APK are unchanged. Prior local step-2 configuration work is preserved. Fixed mock OTP still prevents treating this deployment as secure production authentication; it is intentionally trial-only.

Next proposed step: Kafka recovery/idempotency/poison-event handling and operational visibility, retaining the approved two-second outbox interval. This document does not authorize that step or any Git push/deployment.
