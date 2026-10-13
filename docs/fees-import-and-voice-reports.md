# Administrator fees import and voice reports

Implemented locally in October 2026. This is a fee-information ledger, not a payment gateway, bank reconciliation system, or full accounting/ERP module. No new mobile build is required: the feature is in the school administrator web portal.

## School administrator workflow

1. Sign in to the portal with a School administrator membership and open **Fees**.
2. Download `nexqon-fees-template.xlsx`. Keep headers in row 1 and sheet names `Fees` and `Collections`. Either sheet can be used alone. Enter admission numbers/references as Excel text to preserve leading zeros. Use ISO currency codes, positive decimal amounts without commas/symbols, and real dates in `YYYY-MM-DD` format or native Excel date cells. Formulas are rejected.
3. Fill in dues on `Fees` and dated receipts on `Collections`. Use a fee reference that uniquely identifies the assessment for that student, including year/term/installment, for example `2026-27-OCT-TUITION`. A new academic year should have a new fee reference; academic year alone is not an invoice key.
4. Upload up to 200 total rows / 5 MB. The server matches each admission number to exactly one active student in the signed-in school. Unknown/inactive/ambiguous admissions, duplicate keys, missing referenced invoices, invalid money/dates and unsupported overpayments block the entire batch.
5. Review add/update/unchanged actions, incoming amount/date/year, previous values on corrections, and worksheet-row errors. Nothing is saved until **Confirm add / update**. All rows commit together; omitted rows are never deleted.
6. Ask a read-only question. Voice is optional: opt in to the browser speech service, dictate in English, edit the transcript and press **Search**. A typed fallback is always available. Voice never performs imports or other writes.

### Stable keys and corrections

- Invoice identity: `(school_id, student_id, fee_reference)`. The admission number is resolved by School, not accepted as a client-supplied student ID.
- Receipt identity: `(school_id, collection_reference)`. Keep the same receipt reference to correct its amount/date; a new reference adds a new receipt. An existing receipt cannot be reassigned to another invoice/student.
- A repeated identical workbook produces unchanged records, not duplicated money. Retrying the same batch UUID returns its original committed result. Reusing a batch UUID with changed data or another actor is rejected.
- A school ledger revision accompanies previews. A concurrent administrator import makes an old preview stale; review again rather than silently overwriting newer data. Advisory transaction locks serialize writes within one school, not across schools.
- Monetary values use exact PostgreSQL bigint minor units, with ISO currency precision (including zero- and three-decimal currencies). Reports keep each currency separate.

## Supported questions and definitions

- `This month how many fees are pending`
- `From 3rd grade how many fees are due`
- `This month how much fees collected`
- `Fees collected last month for grade three`
- `Pending fees for third grade`
- `Fees collected October 2026`
- `Collected fees all time`

Pending means the outstanding balance **now** for invoices with a due date in the requested period, after subtracting every recorded collection on those invoices. It does not mean a historical balance at month-end. Without a period, pending covers all due dates, including future dues already entered. Collected means the sum of receipt amounts whose **collection dates** fall within the requested period, not a cumulative paid snapshot and not the upload date. These are proposed defaults awaiting confirmation from the school/product owner.

Reports return both distinct student counts and invoice/receipt counts. One student may owe multiple invoices. “This month” and “last month” use the School service's configured IANA timezone. Named months require an explicit year. Dates use inclusive start / exclusive next-month bounds.

Grade filters use current active enrolments and active classes, not the class at the time the fee was assessed. Default recognised grade codes are `3`, `G3`, `GRADE_3`, `GRADE-3` (and equivalents for grades 1–12); set the grade code in class administration. A class with no matching grade code is not included. Historical-grade reporting and custom grade-label mappings are not implemented.

English question parsing is deliberately bounded and deterministic. Unsupported periods, individual-student free text, multiple grades/periods, mixed metrics, and mutation requests are rejected with a rephrase message. No paid LLM or arbitrary generated SQL is used. The table shows up to 200 rows; counts and totals include every match.

## Architecture, API and authorization

The configurable **Authorization service** route policy owns role access. Only `SCHOOL_ADMIN` may call these routes; the platform-owner role alone, teachers and parents may not. A user with multiple school memberships sees only the active school. The gateway derives school, actor and membership from the authenticated session, never from workbook/request values.

| Gateway endpoint | Operation |
| --- | --- |
| `POST /api/v1/admin/fees/import-preview` | `{ fees, collections }`; validate rows, return counts, actions, issues and ledger revision |
| `POST /api/v1/admin/fees/import-commit` | Same rows plus UUID v4 `batchId` and integer `revision`; atomic add/update |
| `POST /api/v1/admin/fees/search` | `{ question }`; parse a read-only report, resolve live grade membership, return counts/currency totals/details |

School exposes a tenant-scoped internal admission/grade roster lookup without the older 500-student administration-list limit. It does not share its database with Fees. Grade roster responses are explicitly bounded at 20,000; larger rosters fail rather than silently truncate.

The new NestJS **Fees service** owns `schoolconnect_fees`, with tables `fee_ledger_state`, `fee_invoices`, `fee_collections`, `fee_import_batches` and `outbox_events`. School and student identifiers are external IDs; no cross-service foreign keys. Within the ledger, a composite school/invoice foreign key prevents cross-tenant receipt links.

Business updates, before/after import audit data, batch idempotency and `fees.imported.v1` outbox insertion share one database transaction. The existing in-service publisher sends committed events to Kafka; the Audit consumer records `FEE_IMPORT` events. There is **no separate worker service**. Reports read authoritative ledger tables with a consistent read transaction; they do not wait for Kafka projections to catch up. Kafka events contain identifiers/counts, not the entire workbook or receipt details.

Internal token protection and trusted school-context headers apply. New configuration: `FEES_DATABASE_URL`, `FEES_SERVICE_URL`, `FEES_PORT` (default 3110), `FEES_DB_POOL_MAX` (default 4; Render trial 2). JSON request size is capped at 512 KB. The existing central route-policy JSON override must include fee endpoints if the deployment overrides all default routes.

## Running and deployment status

1. Start Docker PostgreSQL/Kafka with the existing scripts.
2. `pnpm install`, `pnpm db:migrate`, then build service packages and `pnpm dev:test-stack` (API 3010, Fees 3210).
3. Start portal with `VITE_API_URL=http://127.0.0.1:3010/api/v1 pnpm dev` from `apps/web` (use PowerShell `$env:VITE_API_URL=...` on Windows).
4. Regression: `pnpm test:fees`. It provisions a labelled synthetic test school and leaves that test school for inspection. No real school data is altered.
5. Optional Docker database tests: set `FEES_INTEGRATION=true` and run `pnpm --filter @schoolconnect/fees test`. Randomly generated test tenants are cleaned up by that suite.

Render demo bootstrap/migrations and the generic service launcher include Fees. Deploy both backend and portal together; the backend needs the extra logical database and updated Kafka event-source parsing. The portal build compiles shared contracts before bundling. No Android APK rebuild is necessary for this administrator-only web feature. Check the deployment status for the pushed commit; local verification alone does not confirm a live deployment.

The existing trial still uses mock OTP. Use synthetic fee records until real authentication and production financial-data controls are enabled.

## Verification and limits

Locally verified: workbook headers/Excel dates/leading-zero text/formula rejection/batch limits; exact currency arithmetic; admission validation; add/update/no-op; receipt-only imports; duplicate/overpayment/currency-change rejection; all-or-nothing writes; stale previews and concurrent same-key retries; tenant/role scoping; monthly and grade reports; optional microphone UI, editable transcript and explicit search; template rendering; service and portal builds, lint and typecheck. Actual Docker PostgreSQL integration and the full authenticated gateway flow pass, including 100 concurrent read requests. The full API run completed those reads in about 2.3 seconds locally; this is not a remote-production capacity/SLA measurement. Local outbox events were delivered and consumed into Audit through Kafka.

Browser microphone events are simulated in component tests. Actual microphone recognition and a manual portal visual check in the user's browser have not been performed. Browser support/permissions/network availability vary. Some browser speech engines transmit audio to the browser provider; explicit opt-in and disclosure are shown. Nexqon does not persist audio or question transcripts. See [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

Pending product decisions/features: confirmation of reporting definitions and a real school Excel sample; refunds/credit notes/waivers/overpayment allocations; receipt cancellation and fee deletion; historical as-of balances and historical-grade reports; multi-language/free-form analytics; exports/pagination beyond 200 visible report rows; formal backup/retention policy and production performance tuning. These are not silently implemented as assumed accounting rules.
