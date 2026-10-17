# Teacher student visibility

## Product rule

An active enrolled student is selectable in teacher workflows only when at least
one active parent/guardian link exists for that student in the same school.
Removing the last parent link hides that parent's children from the current
teacher roster. If another active parent remains, the child stays visible.
Two active guardians must not duplicate a student in the roster.

This is a visibility rule, not deletion: students, enrollment, published results,
attendance history and audit records are retained. School administrators still
see the student in student management so they can correct the parent mapping or
reactivate access through the normal authorized workflow. Nothing automatically
restores a revoked parent.

## Implementation

- School owns the eligibility query in `src/teacher-roster.ts`. It requires an
  active enrollment, active student and same-school active guardian link using
  `EXISTS` (one row per enrollment regardless of guardian count).
- The existing roster endpoint supplies attendance and result student selectors
  in the mobile app, numeric result entry, and school attendance workflows.
- Gateway teacher follow-up and leave lists filter historical entries against
  this roster rather than showing a removed student with a fallback name.
- Publishing already resolves current active recipients, excluding revoked
  links. A result form opened before parent removal now fails with
  `RESULT_STUDENT_HAS_NO_ACTIVE_PARENT`, separately from genuine attachment
  privacy mapping failures. It does not publish to another child's parent.
- Parent membership changes continue to propagate through the existing
  Identity/outbox/Kafka/School flow. The eligibility query uses School's current
  relationship state; it does not introduce cross-service database joins or
  change the two-second outbox polling design.
- Already-open screens/offline caches cannot learn of a removal until refreshed
  online. Current recipients are rechecked server-side before a new publish.

No migration, destructive data cleanup, signing change or APK rebuild is
required for this backend-only change. It takes effect after API/School
deployment and an online roster refresh. This change has not been deployed.

## Verification (2026-10-17)

- School: 8 unit tests pass (including query wiring and administrative visibility).
- Gateway: 177 unit/HTTP boundary tests pass (mock downstream services), including
  private result success, removed-parent stale selection, attachment/student
  mismatch, and follow-up/leave filtering.
- School build, API typecheck, both service lints and API build pass.
- The compiled production roster query was executed with synthetic read-only
  CTE fixtures on the existing Neon rehearsal branch. Four scoped cases passed:
  class roster, second class, second school, and empty school. Fixtures include
  revoked/missing/foreign-school parent links, inactive students/enrollments,
  multiple guardians and one remaining active guardian. No stored rows were read
  or changed by this fixture query.
- Local PostgreSQL is not listening (`ECONNREFUSED`); no local full-stack or
  physical-device E2E pass is claimed.

Run unit checks:

```powershell
pnpm --filter @schoolconnect/school test
pnpm --filter @schoolconnect/api test
```

Run the read-only SQL regression against local PostgreSQL:

```powershell
pnpm test:teacher-roster:db
```

The SQL runner defaults to the local development connection, accepts
`SCHOOL_ROSTER_TEST_DATABASE_URL` for an alternative local database, and rejects
non-local database URLs. `node scripts/teacher-roster-regression.mjs --print-sql`
prints the same fixture cases for read-only execution on an isolated database.
