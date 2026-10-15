# Nexqon School App — Android 0.1.5

[Download APK](https://raw.githubusercontent.com/bazato/schoolconnect-lite/refs/heads/android-apk-nexqon-0.1.5/nexqon-school-app-0.1.5-release.apk)

Source commit: `af0c0f4a4b21e7c9b6247dc01aa02721275980c9`. Package `com.schoolconnect.lite`, versionCode 6. Android 7.0/API 24 or later, ARM64 and ARMv7 phones. No Expo Go or development tunnel required.

## Change

The result student picker now displays student names only. Admission numbers are omitted from both the visible rows and screen-reader labels. Different student records remain separate, selected by student ID, even when their displayed names match. No student records were renamed, merged or removed.

Includes the existing 0.1.4 encrypted-draft restoration, native file-byte handling and upload-availability fixes.

## Install

Install as an update over 0.1.3 or 0.1.4 without uninstalling. This uses the same permanent signing certificate and package identifier, so Android can retain local data. Older debug-signed installations require a one-time uninstall after saving/syncing drafts.

## Verification and limitations

All 60 mobile tests, mobile typecheck/lint, and five signing-configuration tests passed. Android release build, signature, version/package and ZIP alignment checks passed. The packaged bundle retains the hosted API and omits the old admission-number picker label. No physical-device testing is claimed.

This is a release-signed trial build, not a complete production sign-off. OTP remains mocked. Hosted document uploads remain disabled until secure scanning/file validation is implemented and tested; this update does not enable or bypass that restriction.

## Integrity

APK SHA-256: `F4446DD8AA42530CF8DB962CF4E2A96B1B0410EDD2CE3613185644D30AC04086` (45,680,926 bytes).

Certificate SHA-256: `BEC701C72253A1EDBC73EC3860A756840EA8A34680891CFEAA96C9B27972937B`.

Private signing keys and passwords are not included.
