# Architecture

SchoolConnect Lite is one Expo mobile application with role-aware Owner, School Admin, Teacher and Parent contexts. It calls a public NestJS gateway. Business services own separate PostgreSQL databases; no service reads or joins another service's database. The Authorization service is stateless and makes policy decisions using its configured rules and live relationship facts from School.

```text
Expo app → API gateway :3000 → Identity :3101 → identity DB
                            → School :3102 → school DB
                            → Content :3103 → content DB
                            → Attendance :3104 → attendance DB
                            → Files :3105 → files DB → private S3-compatible objects
                            → Notifications :3106 → notifications DB
                            → Audit :3107 → audit DB
                            → Authorization :3108 → School relationship facts
                            → Read Model :3109 → read DB

Identity / School / Content / Attendance / Files / Notifications
  → own transactional outboxes → own in-process publishers → Kafka
Kafka → Notifications consumer group → in-app inbox
      → Audit consumer group → append-only audit records
      → Read Model consumer group → parent/teacher/attendance projections
```

## Boundaries

- Identity validates sessions and issues access/refresh tokens. The gateway asks Authorization for route and resource decisions. Authorization's route and resource-role rules can be configured using environment JSON. School remains the source of teacher-assignment and guardian-child facts. Some controller-level role checks still exist as defense in depth; granting a new role through policy configuration alone may still require application changes.
- The gateway propagates a correlation ID and trusted principal context. It does not own business tables. Internal services require an internal service token.
- A business write and its outbox event commit in one owner-database transaction. Each owning process asynchronously publishes pending outbox rows to Kafka and marks a row complete only after broker acknowledgement. There is no standalone worker service and no direct Kafka client in the mobile app.
- Kafka consumers use independent groups and deduplicate source event IDs. Notifications persists an in-app inbox item and delivery attempt; Audit persists append-only evidence; Read Model builds query tables. Consumers and publishers are at least once, so a duplicate event must be harmless. A temporarily unavailable broker delays projections/notifications/audit but does not undo a committed business write.
- Parent timelines and Teacher post feeds are served from event-built read projections, with School still providing relationship scope. The read database is a rebuildable view, not a source of authorization truth. Notification inbox, child lists, and some administration views remain owner-service reads.
- Scheduled announcements remain durable in Content. Content uses PostgreSQL LISTEN/NOTIFY and an in-process timer to publish them when due.
- Platform Owner has provisioning authority but no implicit school-content access. School Admin is tenant-bound. Recipient lists are calculated server-side and snapshot at publication.
- `DELIVERED` means persisted in the in-app inbox, not pushed to a device. Real SMS, push and production malware-scanning providers remain unconfigured.

## Database ownership

| Service | Database | Owned records |
| --- | --- | --- |
| Identity | `schoolconnect_identity` | users, memberships, invitations, OTP challenges, sessions, outbox |
| School | `schoolconnect_school` | schools, classes, students, enrolments, guardian links, teacher assignments, outbox |
| Content | `schoolconnect_content` | posts, immutable revisions, recipients, attachments, views, outbox |
| Attendance | `schoolconnect_attendance` | batches, immutable events, current pointers, responses, leave requests, outbox |
| Files | `schoolconnect_files` | metadata, upload sessions, file-access evidence, outbox |
| Notifications | `schoolconnect_notifications` | inbox, device tokens, preferences, delivery attempts, outbox |
| Audit | `schoolconnect_audit` | append-only audit events, consumer deduplication |
| Read Model | `schoolconnect_read` | event-built post and attendance projections, consumer deduplication |

Identifiers and tables use lowercase `snake_case` in SQL; API JSON uses `camelCase`. Cross-service IDs are opaque UUIDs with no cross-database foreign keys. Internal foreign keys are used where one service owns both tables. Instants use UTC `timestamptz`, school calendar dates use `date`, and incompatible event changes require a new versioned event type.

The deliberately mocked development OTP is `123456`. Hosting a public environment with that value gives anyone who knows a seeded phone and invitation code a login path; use real OTP, secrets, TLS and provider integration before production.
