# Nexqon School App 0.1.7

Android versionCode: 8. Application ID: `com.schoolconnect.lite`. Uses the existing permanent release certificate; no signing credentials are included in this repository or APK distribution branch.

## Included since 0.1.6

- Phone/passcode sign-in without a public role selector; verified users with multiple memberships choose their workspace after authentication.
- Parent leave applications and teacher acknowledgement.
- Teacher-published weekly timetables available to parents.
- Structured result marks and visual summaries for teachers and parents.
- Updated private-document upload/retry/error handling, 5 MB original limit, and clear scanner-quota messages. The server compresses suitable files to at most 3.4 MB and scans the actual stored bytes through Cloudmersive before allowing attachments.

The standalone APK targets `https://schoolconnect-demo-api.onrender.com/api/v1`, with client demo mode off. The backend intentionally remains a trial with mocked OTP (`123456`). Free scanner quotas apply. This is not a Play Store release or a production sign-off.

## Verification

Mobile tests, typecheck, lint, Android signing tests and the native release build are checked before publication. APK signature, package/version, alignment and SHA-256 are verified separately. Physical Android-device acceptance and a full teacher-to-parent flow remain separate testing steps.

Cloudmersive/R2 live acceptance is recorded in [private-upload-processing.md](private-upload-processing.md).

## Built artifact (17 October 2026)

- Source: `a528ad8ac7f2cffae64a9c12af73b83fdf5a1134`.
- APK: `nexqon-school-app-0.1.7-release.apk`, 45,722,014 bytes.
- SHA-256: `6eaa224730eea395a6d8009e7df033da32944cdba70fc25628e850ef509dc7a9`.
- Permanent certificate SHA-256: `bec701c72253a1edbc73ec3860a756840ea8a34680891cfeaa96c9b27972937b`.
- Native `assembleRelease` passed, including Android release lint. APK Signature Scheme v2 and 16 KB ZIP alignment verified; release is not debuggable. Package, version, ARM64/ARMv7 libraries, embedded Hermes bytecode and live API URL verified.
- 91 mobile tests and five signing-safety tests passed; mobile typecheck/lint passed. The isolated dependency lockfile matched committed source after normalizing Windows line endings.
- No new Android device/emulator acceptance or full teacher-to-parent end-to-end testing is claimed.

## Download

[Download the signed 0.1.7 APK](https://raw.githubusercontent.com/bazato/schoolconnect-lite/4468c9286059359dd20b05e1382ede13fec3edeb/nexqon-school-app-0.1.7-release.apk)

Published on artifact branch `android-apk-nexqon-0.1.7`, commit `4468c9286059359dd20b05e1382ede13fec3edeb`. Public download returned HTTP 200 and the expected Content-Length. Backend readiness returned HTTP 200 after the free service woke from idle.
