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
