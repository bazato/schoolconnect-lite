# Architecture

SchoolConnect Lite is one mobile product backed by independently runnable services. The public gateway owns no business tables. Each business service owns one PostgreSQL database and publishes versioned events through its own transactional outbox.

```text
Expo mobile app (Owner, School Admin, Teacher or Parent context)
                        |
                  Public API gateway :3000
                        |
       +----------------+------------------------------+
       |                |               |              |
 Identity :3101   School :3102    Content :3103  Attendance :3104
       |                |               |              |
 identity DB       school DB       content DB     attendance DB

       Files :3105       Notifications :3106       Audit :3107
            |                    |                     |
        files DB          notifications DB          audit DB
            |
  private S3-compatible storage adapter
```

## Boundary rules

- No service reads another service's database.
- No cross-database foreign keys exist. External identifiers are opaque UUIDs validated by the owning service.
- Foreign keys are used inside a service database where both tables share one lifecycle and owner.
- The mobile application calls only the public gateway.
- Platform Owner has platform provisioning authority but no school content access. School Admin is bound to one school and cannot enumerate or mutate other schools.
- Identity owns accounts, memberships and invitations; School owns schools, classes and teacher assignments. The gateway coordinates provisioning without shared database access.
- The gateway resolves the authenticated principal through Identity and checks live guardian/teacher authorization through School before delegating.
- Clients never supply the authoritative recipient list. The gateway resolves recipients from School and sends an immutable snapshot to Content.
- Content and Attendance commit their business record and outbox event in the same database transaction.
- Notifications and Audit are idempotent consumers of versioned events. Provider delivery is not considered device delivery.
- Files remain quarantined until an asynchronous scanner moves them to `READY`.

## Database ownership

| Service | Database | Owned records |
| --- | --- | --- |
| Identity | `schoolconnect_identity` | users, memberships, invitations, OTP challenges, sessions |
| School | `schoolconnect_school` | schools, configuration, classes, students, enrollment, guardian links, teacher assignments |
| Content | `schoolconnect_content` | posts, revisions, recipients, attachments, views |
| Attendance | `schoolconnect_attendance` | batches, immutable events, current pointers, responses, leave requests |
| Files | `schoolconnect_files` | file metadata, upload sessions, file-access evidence |
| Notifications | `schoolconnect_notifications` | inbox, device tokens, preferences, delivery attempts |
| Audit | `schoolconnect_audit` | append-only audit events and consumer checkpoints |

## Naming conventions

- Database and table identifiers use lowercase `snake_case`.
- Primary keys are UUIDs named `id`; external references end in `_id` but have no cross-database constraint.
- UTC instants use `timestamptz` and end in `_at`; school calendar dates use `date`.
- Mutable aggregates carry a version. Historical attendance and post revisions are append-only.
- Event types use a namespaced, versioned format such as `attendance.student-absent.v1`.
- API JSON uses `camelCase`; SQL remains `snake_case`.

## Current provider boundary

Development OTP is deliberately mocked as `123456`. The database records hashed challenges and sessions, but SMS delivery and production JWT/refresh-token signing remain provider work. S3 signing, malware scanning, APNs/FCM delivery, and event-broker transport are adapter boundaries rather than dependencies between business services.
