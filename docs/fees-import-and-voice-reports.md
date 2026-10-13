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
- `Can you show the pending fees for the current month for School One?` (use the active school's exact name/code)
- `What payments were received in the previous month for our school?`

Pending means the outstanding balance **now** for invoices with a due date in the requested period, after subtracting every recorded collection on those invoices. It does not mean a historical balance at month-end. Without a period, pending covers all due dates, including future dues already entered. Collected means the sum of receipt amounts whose **collection dates** fall within the requested period, not a cumulative paid snapshot and not the upload date. These are proposed defaults awaiting confirmation from the school/product owner.

Reports return both distinct student counts and invoice/receipt counts. One student may owe multiple invoices. “This month” and “last month” use the School service's configured IANA timezone. Named months require an explicit year. Dates use inclusive start / exclusive next-month bounds.

Grade filters use current active enrolments and active classes, not the class at the time the fee was assessed. Default recognised grade codes are `3`, `G3`, `GRADE_3`, `GRADE-3` (and equivalents for grades 1–12); set the grade code in class administration. A class with no matching grade code is not included. Historical-grade reporting and custom grade-label mappings are not implemented.

The default **free** interpreter handles natural English filler, current/present/this month, previous/last month, pending/balance/not-paid and receipt/payment synonyms, grade words, and the active school's exact name/code. Unknown filters are not silently discarded. “Fees for the current month” returns a clarification with pending/collected suggestions; selecting a suggestion still requires Search. No report executes for a clarification. Named schools cannot change session scope.

Optional **Groq Free** and **self-hosted Ollama** interpreters are implemented. This is a grounded question-to-filter planner, not a vector RAG database and not unrestricted text-to-SQL. The gateway first tries the free parser; only otherwise-unrecognised questions reach the configured model. A small report-definition context supplies permitted metrics, current/previous-month boundaries, timezone and the active school name/code. No student lists, ledger rows, fee amounts, database credentials or tools are sent. The question itself and school context are sent to Groq or the configured self-hosted model, so administrators should avoid including personal data. Browser audio still goes only to the browser's speech provider, never to this AI adapter.

### Groq Free setup on Render

1. Create a Groq account and confirm it is on the **Free** plan. Do not upgrade to a paid plan or add paid billing for this trial.
2. Create an API key and enter it directly into the API service's protected Render environment as `GROQ_API_KEY`. Never commit it, put it in frontend variables or paste it in chat.
3. Set `FEES_QUERY_PROVIDER=groq` and `GROQ_FREE_TIER_CONFIRMED=true` after confirming the account's plan. The confirmation flag records the operator's acknowledgement; it does not inspect billing or guarantee costs if the account is subsequently upgraded.
4. Set `FEES_AI_MODEL=openai/gpt-oss-20b`. This model is hosted by **Groq**; it does not call the OpenAI API. Requests go only to Groq's fixed HTTPS chat-completions endpoint using strict JSON-schema output, temperature zero and a 1024-output-token cap. No database or model installation is needed on Render.
5. Keep the conservative defaults: `FEES_AI_GLOBAL_REQUESTS_PER_MINUTE=3`, `FEES_AI_DAILY_REQUESTS=100`, `FEES_AI_MAX_CONCURRENT=1`, `FEES_AI_REQUESTS_PER_MINUTE=10` per user and `FEES_AI_TIMEOUT_MS=15000`.

Missing key or Free-plan confirmation falls back to the deterministic parser without taking the API offline. Provider timeouts, authentication failures, rate limits, exhausted local budgets and invalid responses return a clarification without a financial query. There are no automatic retries. Free-plan limits are shared at the provider organization/account level and can change. The application counters are per gateway process, reset on restart and are not a durable distributed spending limit. Keeping the Groq account on Free is essential to the no-paid-API requirement.

The Blueprint contains the provider defaults and protected-secret placeholders. A GitHub auto-deploy does not necessarily apply new Blueprint variables to an existing service. Configure the environment explicitly or sync the Blueprint, then redeploy. Code deployment and live Groq activation are separate checks: `interpretedBy: 'groq'` on an otherwise unrecognised, successfully interpreted question confirms the latter. Standard example questions intentionally return `interpretedBy: 'rules'`, even when Groq is enabled.

See [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [Groq rate limits](https://console.groq.com/docs/rate-limits) and [Groq billing FAQ](https://console.groq.com/docs/billing-faqs).

### Optional local Ollama setup

The model returns a strict JSON plan: status, metric, date range, optional grade, explicitly named school and clarification message. Independent local validation rejects extra fields/SQL, unsupported metrics, invalid dates/grades, other-school names, refusal and incomplete/malformed responses. Known unsupported student/admission/currency/section/academic-year/comparison/overdue/refund/negative filters are stopped before AI. The model is instructed not to omit any other unsupported filter. As with any language model, interpretation is not infallible: the exact filters and active school remain visible; verify these before relying on a report. The Fees service revalidates the plan and executes only existing parameterised, allowlisted report queries against authoritative financial records. It never executes model-generated SQL or accepts a model-chosen school ID.

Set `FEES_QUERY_PROVIDER=ollama`, `FEES_AI_BASE_URL=http://127.0.0.1:11434` and `FEES_AI_MODEL` naming an explicitly selected, already installed local model to enable AI. No paid API key is needed. Set `OLLAMA_NO_CLOUD=1` on the Ollama host; cloud model names are rejected. Missing model or invalid provider fails startup rather than enabling an implicit model. Default `FEES_QUERY_PROVIDER=rules` makes no AI requests. Optional limits: `FEES_AI_TIMEOUT_MS=15000` (max 60000), `FEES_AI_REQUESTS_PER_MINUTE=10` per authenticated user (max 60), `FEES_AI_MAX_CONCURRENT=1` per gateway process (max 10). Requests use JSON-schema output, temperature zero, a 512-output-token cap and a 4096-token context window. Timeouts, rate limits and invalid/incomplete responses become clarifications without a ledger query. There are no automatic retries or model downloads. Model quality/latency must be evaluated on the target machine, and the selected model's licence must permit the intended use.

Ollama must run on a computer with sufficient RAM/CPU (GPU optional) that stays on. The current developer laptop has about 8 GB RAM and no detected Ollama command; Docker and other development tools also consume memory. A small model would require benchmarking; this is not a verified hardware fit. There are no per-query API bills for local inference, but electricity, hardware and any rented host are not magically free.

**Render deployment:** localhost on Render is Render's container, not the developer's laptop. The existing Render trial can run the deterministic parser, but a local Ollama adapter does not make a model available remotely. To use self-hosted AI from Render, configure a reachable trusted HTTPS origin and protected `FEES_AI_AUTH_TOKEN`, with an authenticated reverse proxy in front of your model server. Plain HTTP is accepted only for loopback; redirects and embedded URL credentials are rejected. Do not expose Ollama's unauthenticated default port to the internet. Per-process concurrency/rate limits are not distributed limits. No host/tunnel/model installation or remote AI activation has been performed here.

The table shows up to 200 rows; counts and totals include every match. Provider support is covered by mocked Groq and Ollama response tests; that does not demonstrate a live configured provider. A protected Groq key, Free-plan confirmation and a live acceptance query remain required for activation. No new mobile APK is needed.

## Architecture, API and authorization

The configurable **Authorization service** route policy owns role access. Only `SCHOOL_ADMIN` may call these routes; the platform-owner role alone, teachers and parents may not. A user with multiple school memberships sees only the active school. The gateway derives school, actor and membership from the authenticated session, never from workbook/request values.

| Gateway endpoint | Operation |
| --- | --- |
| `POST /api/v1/admin/fees/import-preview` | `{ fees, collections }`; validate rows, return counts, actions, issues and ledger revision |
| `POST /api/v1/admin/fees/import-commit` | Same rows plus UUID v4 `batchId` and integer `revision`; atomic add/update |
| `POST /api/v1/admin/fees/search` | `{ question }`; interpret a read-only report, resolve live grade membership, return counts/currency totals/details and `schoolName`/`interpretedBy`, or `{ kind: 'CLARIFICATION', message, suggestions }` without running a report |

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

Pending product decisions/features: confirmation of reporting definitions and a real school Excel sample; selection/installation/live evaluation and a reachable host for the optional local AI model; refunds/credit notes/waivers/overpayment allocations; receipt cancellation and fee deletion; historical as-of balances and historical-grade reports; multi-language/free-form analytics beyond supported metric/date/grade filters; exports/pagination beyond 200 visible report rows; formal backup/retention policy and production performance tuning. These are not silently implemented as assumed accounting rules.

Optional local AI implementation follows [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) and [Generate API](https://docs.ollama.com/api/generate). The user-visible answer/totals are built from the ledger report, not an AI-generated narrative.
