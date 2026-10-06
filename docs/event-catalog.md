# Domain event catalog

Services insert these versioned events in the same transaction as the business write. Each owning service publishes its own outbox to Kafka after commit and completes an outbox row only after broker acknowledgement. Independent Notification, Audit and Read Model consumer groups apply idempotent effects. Delivery is at least once, so all consumers deduplicate by source event ID. New post/attendance events carry notification and projection snapshots; older events may still require source-service lookups during replay.

| Event type | Owner | Payload highlights | Current consumer effect |
| --- | --- | --- | --- |
| `content.post-published.v1` | Content | `schoolId`, `postId`, `postType`, recipient snapshot, `correlationId` | Parent inbox + Audit |
| `content.post-scheduled.v1` | Content | scheduled post snapshot | Read Model + Audit |
| `content.post-snapshot.v1` | Content | historical post snapshot for backfill | Read Model |
| `content.post-updated.v1` | Content | `schoolId`, `postId`, revision, recipient snapshot, `correlationId` | Parent inbox + Audit |
| `content.scheduled-post-updated.v1` | Content | `schoolId`, `postId`, revision, `correlationId` | Audit only; eventual publication emits `post-published` |
| `content.post-archived.v1` | Content | `schoolId`, `postId`, actor, `correlationId` | Audit only |
| `attendance.student-absent.v1` | Attendance | `schoolId`, `studentId`, attendance event/date, `correlationId` | Guardian inbox + Audit |
| `attendance.recorded.v1` | Attendance | per-student status and class/date snapshot | Read Model |
| `attendance.snapshot.v1` | Attendance | historical current-status snapshot for backfill | Read Model |
| `attendance.corrected.v1` | Attendance | `schoolId`, `studentId`, new status, superseded event, `correlationId` | Guardian inbox + Audit |
| `attendance.projection-rebuilt.v1` | Attendance | `schoolId`, removed/restored row counts, actor, `correlationId` | Audit |
| `attendance.absence-acknowledged.v1` | Attendance | `schoolId`, event, guardian, response/leave ID, `correlationId` | Audit only |
| `attendance.leave-reviewed.v1` | Attendance | `schoolId`, leave ID, student, decision, `correlationId` | Guardian inbox + Audit |
| `identity.account-provisioned.v1` | Identity | `schoolId`, membership, role, actor, `correlationId` | Audit |
| `identity.membership-updated.v1` | Identity | `schoolId`, membership, changed fields, actor, `correlationId` | Audit |
| `identity.membership-revoked.v1` | Identity | `schoolId`, membership, actor, `correlationId` | Audit |
| `identity.invitation-reissued.v1` | Identity | `schoolId`, membership/invitation IDs, actor, `correlationId` | Audit; never includes invitation code |
| `identity.role-switched.v1` | Identity | from/to membership, actor, `correlationId` | Audit |
| `files.upload-completed.v1` | Files | `schoolId`, `fileId`, actor, `correlationId` | Audit; file completion performs validation/scanning in-process |
| `school.created.v1` | School | `schoolId`, code, actor, `correlationId` | Audit |
| `school.updated.v1` | School | `schoolId`, changed fields, status, actor, `correlationId` | Audit |
| `school.class-upserted.v1` | School | `schoolId`, class, academic year, actor, `correlationId` | Audit |
| `school.academic-year-rolled-over.v1` | School | `schoolId`, from/to years, class count, actor, `correlationId` | Audit |
| `school.teacher-assigned.v1` | School | `schoolId`, assignment, teacher, class, actor, `correlationId` | Audit |
| `school.teacher-assignment-updated.v1` / `school.teacher-assignments-revoked.v1` | School | assignment/teacher IDs, actor, `correlationId` | Audit |
| `school.guardian-linked.v1` | School | `schoolId`, student, guardian, class, actor, `correlationId` | Audit |
| `school.guardian-link-updated.v1` / `school.guardian-links-revoked.v1` | School | guardian/student link IDs, actor, `correlationId` | Audit |
| `school.student-updated.v1` / `school.configuration-updated.v1` | School | changed records, actor, `correlationId` | Audit |
| `notifications.created.v1` | Notifications | `schoolId`, notification/source event IDs, recipient, in-app channel, `correlationId` | Audit; inbox creation and delivery attempt are transactional in Notification service |
| `notifications.read.v1` | Notifications | `schoolId`, notification/actor IDs, `correlationId` | Audit |

`correlationId` is diagnostic metadata, never an authorization credential. External IDs supplied by a client are validated to a bounded safe format or replaced with a generated UUID. New incompatible payloads require a new event version. This catalog describes events that exist today; push/SMS/email, more complete read projections and full event sourcing remain future work.
