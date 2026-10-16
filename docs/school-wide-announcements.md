# Administrator school-wide announcements

## Delivered locally

School administrators have an **Announcements** page in the web portal and a **School announcements** section in mobile school account management. They enter a title/message and confirm publication to all classes. No teacher assignment or manually selected class is required. Platform owners can also publish while managing a selected school.

Parents see the same notice in the timelines of their linked children in every targeted active class. Active teachers receive an in-app notification and a separate read-only school-notices section on Teacher Home. A teacher cannot edit or archive the administrator's notice. The web publisher can edit with optimistic revision checking or archive their own notice. Other administrators can view it but do not impersonate the original publisher to edit it.

This is text-only publishing. Existing attachment scanning restrictions, mock OTP, two-second outbox publishing and deployment configuration are unchanged. Notifications mean in-app inbox delivery, not a claim of live SMS or native push delivery.

## Flow and scope

1. The gateway checks the configured administrator route policy and derives the school/actor/membership from the verified session (or centrally approved owner-selected scope).
2. School supplies distinct active student/guardian pairs from all active classes in that school. Identity supplies active teacher memberships; their user IDs are deduplicated.
3. Content stores one `ANNOUNCEMENT` with `SCHOOL` audience and no class ID, parent-child recipients, teacher recipient snapshots and an outbox event in one transaction. Browser-supplied school, actor, recipients, post type, class or attachments cannot override these fields. Publication retries are serialized by actor/idempotency key to prevent duplicate posts after a lost response.
4. The existing publisher sends the event to Kafka. Read builds parent timeline entries; Notifications creates per-parent-child inbox entries and one student-independent entry per teacher. Redelivery does not duplicate these entries. No new standalone worker is added.
5. Revisions use the stored original parent/teacher audience and reject stale revision numbers. Archiving removes the notice from active feeds while preserving history. Already delivered notifications cannot be recalled. Newly linked guardians/teachers do not receive retrospective notifications; current teachers can read active school notices.

Teacher Home reads school notices separately from the teacher's own editable publishing list, avoiding accidental “edit administrator notice” actions. Teacher detail access is limited to published/updated school-audience, class-independent announcements in the teacher's active school; it does not grant access to another teacher's class posts or private results.

## API

- `GET /api/v1/admin/announcements`: latest 100 school notices, including archived notices for management.
- `POST /api/v1/admin/announcements`: `{title, body, idempotencyKey}`. Title: 150 characters maximum; message: 20,000. Server fixes audience to the school.
- `PATCH /api/v1/admin/announcements/:postId`: `{title, body, expectedRevisionNumber}`; original publisher only.
- `POST /api/v1/admin/announcements/:postId/archive`: `{expectedRevisionNumber}`; original publisher only.
- Teacher home BFF adds a separate `schoolAnnouncements` list. Existing post detail provides read-only staff access to these notices.

Custom authorization route configurations must explicitly permit these administrator paths; the implementation does not silently expand a custom policy.

## Database and deployment

Migration `106-school-announcements.sql` creates Content's `post_staff_recipients(post_id, school_id, user_id)` snapshot table. Only `post_id` has a local foreign key; Identity user IDs remain service-owned references, not cross-service database foreign keys. Migration 106 is included in the managed migration manifest.

Apply migrations 105 and 106 as needed before deploying updated services, then deploy the portal and generate a new APK. The currently published APK has none of these local changes. No live database migration, Git push or deployment has been performed in this task.

Following the Neon/PostgreSQL skill guidance, the existing database driver and service boundaries are retained and database behavior is exercised in disposable local databases rather than modifying live Neon data.

## Tests

Verification passed: 158 API tests, 66 mobile tests, 32 web tests, four notification consumer tests and 15 managed-runtime/migration tests. The initial parallel client run hit test-worker startup timeouts; the single-worker rerun completed successfully. Lint, type checks, backend/web production builds and an Android Hermes bundle export passed. The bundle export is not a signed APK or a physical-device test.

The API tests cover permission denial, forged school/recipient fields, inactive schools, blank messages, publisher impersonation and teacher read-only access. The notification consumer test covers parent-child and deduplicated teacher fan-out. Web component tests exercise publishing, confirmation cancellation, edit revisions and preserving the draft/idempotency key after network failure.

`pnpm test:accounts` now includes the original 13 account tests and three announcement acceptance scenarios: cross-class parent + teacher delivery through real Kafka with replay/tenant isolation, revisions with persistent teacher recipients/stale-edit rejection, and archive/history behavior. It uses five disposable localhost PostgreSQL databases and its own Kafka topic, with cleanup restricted to those generated names. It does not test physical Android/iOS devices, native push or production throughput.

## Sign-in proposal — awaiting approval

Keep separate role registrations and the shared four-digit passcode. Remove role selection from the welcome screen: authenticate phone/passcode first; open the only applicable workspace automatically, or show the already-authorized workspaces after verification if there are several. Workspace selection must call the server's membership-switch endpoint, not merely change the UI role. No unregistered role is offered or automatically granted. The existing sign-in flow is not changed by this announcement implementation.
