# Parent leave, class timetables, result charts and web workspaces

Implemented locally after source release 0.1.6. Not deployed and not in the published 0.1.6 APK.

## Parent leave applications

Parent Home → Apply for leave → selected child, inclusive start/end dates, reason → Submit to teacher. The gateway resolves the child's current enrollment and active assigned teacher accounts. A request cannot be submitted when no active teacher is assigned; the parent is told to contact the school.

Teacher Home → Leave requests → selected assigned class → optional reply → Acknowledge application. Parents see Submitted/Acknowledged and the reply. This records receipt, not approval, and never marks attendance automatically. Existing absence acknowledgements and administrator review of absence-linked leave notes remain unchanged.

Attendance owns `parent_leave_applications`. Class/student/guardian IDs are references across service boundaries, not cross-database foreign keys. The application and notification event commit in the same transaction. Exact same child/guardian/date retries return the existing application; a changed reason for those dates is rejected. Concurrent acknowledgements produce one event. Reasons stay in Attendance, not Kafka, push messages or audit event metadata.

All currently assigned active teachers for the class receive the application notice. The first teacher acknowledgement is final; another teacher does not overwrite it. No principal-teacher hierarchy, leave approval policy, attachments, or attendance auto-exemption is invented.

## Timetables

Teacher Home → Timetable → add weekday, 24-hour start/end, subject and optional room → Publish. This replaces the class's current weekly timetable. Parent Home has a permanent Timetable shortcut independent of Posts. Parents can read the latest published version but cannot edit it. Times are school-local; Monday is day 1 and Sunday day 7. Overlapping or invalid periods are rejected; adjacent periods are valid.

Content owns append-only `class_timetables` versions. Publication uses an expected version and a per-school/class transaction lock. Conflicting edits return `TIMETABLE_VERSION_CONFLICT` rather than silently replacing another teacher's update. An identical retry is safe. All parents currently linked to that class receive one notice per guardian, including when siblings share a class. The timetable is retrieved directly from Content and remains available after older feed posts fall out of view. Network availability is still required; this is not an offline timetable cache.

## Result charts

Parent Home → Result charts shows only that child's recorded exam/subject percentages. Teacher Home → Result charts shows class means for the selected class, with sample counts, and a numeric-result publication form. Publishing a numeric result also creates a private Result post for the selected student's current guardians. Existing web Excel result publishing now persists numeric scores too.

Content owns `result_scores`, referencing its own `posts` table. Marks and posts commit together. Same-batch retries are idempotent. For each student/exam/subject the latest published numeric record is used; older duplicate entries do not count the child twice in class averages. Marks normalize to percent before averaging. Different exams are separate bars, not an invented weighted overall mark or rank. Archived posts and results whose text was subsequently revised are excluded from numeric charts.

PDF/image-only results and results imported before migration 107 have no trustworthy structured scores. They are not OCR'd or guessed; they remain accessible through Posts. Charts explain this limitation and show an empty state when no numeric data exists. No paid chart or AI service is required.

## Web sign-in and navigation

No School Administrator/Platform Owner dropdown before authentication. Phone and passcode identify the account. First activation still uses invitation/OTP, then the existing passcode setup. A single web membership opens directly. Multiple verified web memberships show workspace buttons after authentication, labeled by role and school name. Returning sessions retain their active workspace. Teachers and parents are still directed to the one mobile app.

Mobile follow-up: removed the fixed Teacher/Parent/School Administrator/Platform Owner selector from mobile login too. Normal login and activation no longer send a preselected role. One verified membership opens automatically; multiple verified memberships are offered only after authentication. Selection is by membership ID, so the same role in two schools remains distinguishable. The session is not persisted until selection completes. Profile no longer has always-visible role chips; verified multi-workspace accounts can explicitly open Change workspace. Switching clears previous workspace data; delayed teacher refreshes cannot refill the old context. Mock OTP is unchanged. This follow-up still requires a new APK; it is not in 0.1.6.

Owners select schools through school directory cards, not a global school dropdown. Header workspace buttons invoke the existing server-validated membership switch. School-scoped requests retain the selected school header; authentication requests never carry a selected-school override. Authorization checks remain in the configurable policy service and live School relationships.

## APIs

- Parent: `GET/POST /parent/leave-applications`, `GET /parent/timetable`, `GET /parent/result-charts`.
- Teacher: `GET /teacher/leave-applications`, `POST /teacher/leave-applications/:id/acknowledge`, `GET/POST /teacher/timetable`, `GET /teacher/result-charts`, `GET /teacher/result-roster`, `POST /teacher/result-scores`.
- Read context is `studentId` for parents, `classId` for teachers. Actual school, guardian, publisher and recipients come from server context, not client-supplied scope.
- New `CLASS` capability means any live active class assignment for timetable/leave. Numeric-result access still requires `RESULTS` permission.
- New events: `attendance.leave-application-submitted.v1`, `attendance.leave-application-acknowledged.v1`, `content.timetable-published.v1`.

Normal flow: mobile → gateway → policy + School relationship check → Attendance/Content transaction (business row + outbox) → existing publisher → Kafka → Notifications/Audit consumers → in-app inbox → scoped deep link. No new worker service or polling change.

## Verification and rollout

`pnpm test:experiences` uses three disposable localhost databases and its own temporary Kafka topic. It tests schema replay, tenant/recipient isolation, concurrent submissions/publication, outbox rollback, numeric marks, duplicate Kafka delivery and privacy. HTTP gateway tests use mocked downstream services; mobile/web component tests use a DOM/native-component substitute, not a physical device.

Before deployment, rehearse `107-school-experiences.sql` on a Neon branch, then apply the managed migration to Attendance and Content. Deploy updated services, including Authorization, School, Notifications and Audit, and the web frontend. Explicitly configured authorization route overrides must include the new routes (default policy already includes them). Generate the next signed APK for mobile access to these features. Do not reuse version 0.1.6 for a different binary.

Mock OTP remains unchanged. Private file uploads remain disabled pending genuine scanning. No production data or cloud configuration was changed during this implementation.

### Completed local checks (2026-10-17)

- 400 unit/component/HTTP-contract checks passed: API 169, mobile 75, web 34, contracts 80, Authorization 22, Notifications 7, Audit 3, Content 2, Attendance 3, School 5.
- 18 new experience acceptance scenarios passed against disposable PostgreSQL databases and a real local Kafka broker.
- 17 account/announcement regression scenarios passed against disposable PostgreSQL databases and real Kafka, including class access without attendance permission.
- 15 managed-runtime/migration checks passed. All ten affected workspaces passed typecheck and lint; affected backend builds, mobile web export, web production build and Android Hermes bundle export passed.
- The Neon/PostgreSQL skills guided migration isolation and service-owned schema preservation. Live Neon remains unchanged. No real Android device installation or live-school end-to-end test was performed.
- Existing APK 0.1.6 was published separately to GitHub artifact commit `1943b8342fc5259746fa4e91dc87aab5a522d1d1`. Its public download was checked against SHA-256 `42D3DDCE931AEDF5D4D2CEE1CD39EDA972C99CFDC386C155D91E92B8DA68B76F`. That binary does not include this feature work.

Mobile sign-in follow-up checks: 86 mobile checks and 170 gateway checks passed; affected typecheck/lint, API build and Android bundle export passed. Coverage includes automatic opening for each single assigned role, no pre-login role parameter, post-authentication selection by exact membership ID, two schools with the same role, rejected unassigned workspaces, activation/passcode setup, and sign-out before selection. Device installation and rollout remain pending.
