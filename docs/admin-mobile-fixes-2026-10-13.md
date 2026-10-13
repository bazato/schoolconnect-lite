# Administration and mobile fixes — 2026-10-13

## Changes

- Teachers can open a class/subject selector on Home, Posts and Attendance. It lists all active assignments and explains when only one has been assigned. A selector choice controls publishing, attendance and follow-ups.
- Teacher headers and account screens use the authenticated school's name instead of the hardcoded demonstration school.
- The administration portal only offers owner and school-administrator memberships. An account with both parent and administrator roles automatically opens its administrative membership on web. Parent-only and teacher-only accounts receive guidance to use mobile.
- The web class table has an editor for name, code, grade and status. The class ID and academic year remain stable; use academic-year rollover for a new year.
- The web teacher table has profile editing and class-assignment management. Additional assignments use the same teacher membership and do not create a new identity or invitation. Assignment class, status and permissions can be changed.
- The web student table has editing for name, class and status. Admission numbers and guardian links remain intact.
- Child-switch cards have fixed dimensions and names are constrained, while the selected-child summary stays within the screen. Switching children clears the previous timeline and guards against stale attendance responses.
- A visible Sign out button is available in the portal header, including at narrow screen widths.

### In-action teacher class switching

- The selector is now available inside new homework, result and announcement forms, attendance entry and absence follow-ups, not just on the main tabs.
- Each action lists only assignments with its required permission. The backend still validates the assignment when publishing or recording attendance.
- Switching a publishing form saves its current draft immediately to the original assignment's device storage key. The destination assignment opens its own draft, without transferring private files or selected students. Switching is disabled during upload/publishing or draft restoration.
- Attendance switching requires confirmation before unsaved marks are discarded. It preserves the selected date, clears roster/version/correction state and reloads the new class. Submission is disabled until the roster matches both the current class and date.
- Follow-up and result-roster responses are ignored after their class context changes, preventing a slow previous request from overwriting the new class's data.
- Published-post editing retains its original audience and class. To publish to another class, create a new post rather than changing an existing post's recipients.

## Validation

Passed workspace lint and type checks, all unit suites (including 43 API and 9 web tests), service builds, and web/mobile exports.

Passed PostgreSQL/Kafka regressions covering class edits, duplicate class-code rejection, teacher profile updates, two assignments on one teacher, repeated assignment submission, a second child linked to an already-activated parent, correct school names, archived-class authorization, and cross-school/parent rejection.

Additional class-switching validation passed: 30 mobile tests (including interactive selector/confirmation/error tests), and a real PostgreSQL/Kafka scenario where one teacher publishes homework and announcements and records absences in two classes. Each child's timeline and class follow-ups remain isolated; a class-A roster submitted to class B is rejected.

Passed the ten-stage product workflow suite and the security/concurrency integration suite. The latter checks single-use OTP verification, refresh-token replay rejection, concurrent absence acknowledgement, cross-school isolation, and logout revocation.

The browser automation surface was unavailable during this session. Physical-device visual verification of the second-child layout remains necessary; automated form tests and compilation do not establish visual correctness on a device.

## Local testing

With Docker PostgreSQL and Kafka running, build the services and start `pnpm dev:test-stack`. This binds the gateway to `http://127.0.0.1:3010/api/v1` and internal services to ports 3201–3209. It uses development OTP and a larger local test rate limit; these settings are not deployed.

Run `pnpm test:admin-mobile`. For the existing product/integration scripts, set `TEST_API_URL=http://127.0.0.1:3010/api/v1`.

Start the web portal with `VITE_API_URL=http://127.0.0.1:3010/api/v1` and `pnpm --filter @schoolconnect/web dev`. The portal is available at `http://127.0.0.1:5173`.

The current regression administrator is `+9665068203754`, with mock OTP `123456`. These are local synthetic test accounts, not Render accounts.

## Initial delivery status (before GitHub push/deployment)

Source changes are local and have not been pushed or deployed. The Android preview build uses the Render API URL and requires installing the new APK for the mobile changes. Render must receive the backend and web changes before the new administration workflows are available remotely.

Android release assembly succeeded. The debug-signed trial APK is saved at `dist-native/schoolconnect-lite-android-preview-2026-10-13.apk` (79,304,052 bytes), and its signature verification passed. It is a preview build, not a Play Store production release.

APK SHA-256: `D349FD15F77B0BEA7AE5127BCA7DF785E063966B9AC5E6A647E74C9399751047`.

The subsequent in-action class-switching build also assembled successfully and passed signature verification. Use `dist-native/schoolconnect-lite-android-class-switch-2026-10-13.apk` for these additional fixes; it supersedes the earlier preview linked above. It remains debug-signed and targets the Render API. Device visual testing and source push/deployment are still outstanding.
