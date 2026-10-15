# Nexqon School App — Android 0.1.4

[Download APK](https://raw.githubusercontent.com/bazato/schoolconnect-lite/refs/heads/android-apk-nexqon-0.1.4/nexqon-school-app-0.1.4-release.apk)

VersionCode 5; package `com.schoolconnect.lite`; Android 7.0/API 24 or later; ARM64 and 32-bit ARM phones. No Expo Go or development tunnel is required. Source commit: `2e28a0ee5f5014bbac1803d4af8aa55302adf60d`.

## Fixed

- Native encrypted-draft restoration passes bytes into Android's encryption bridge rather than a base64 string. Existing v1 drafts and per-user encryption keys are retained. Failed restoration does not overwrite the saved draft with empty fields.
- Native attachments read file bytes through Expo FileSystem instead of assuming browser Blob methods are available. Binary checksums and upload readiness are validated.
- School-name letter spacing and long-name layout constraints are corrected.
- Student selection shows full names and admission numbers, with one option per student ID. Separate stored records are not automatically merged; existing duplicate-data corrections require confirmation of the official admission number.
- File availability comes from the authenticated API, with checking, disabled and retry states. File-based results cannot be published when storage is disabled; optional text-only homework/announcements remain usable.

## Important limitations

**Actual hosted document uploads are still disabled** until secure scanning/file validation is completed. This APK fixes the native errors and explains the server restriction; it does not bypass that restriction. OTP is still mocked. This remains a release-signed trial build, not a full production sign-off.

Mobile 59 tests, API 142, Authorization 18, Files 6 and signing configuration 5 tests passed. Lint/typecheck, mobile web export and changed backend builds passed. Native/S3 calls in unit tests are contract doubles; no physical Android device or live document-upload E2E is claimed.

## Installation

Install this as an update over **0.1.3**. It uses the same permanent certificate, so do not uninstall 0.1.3 merely to update: Android retains its local data. If still using an older debug-signed APK, sync any drafts and uninstall that old debug build first. Server-side accounts, records and posts are unchanged.

## Integrity

APK SHA-256: `F5D25013FB60A7CD34491FD132DFE6C46563E2913D54A1BABD19124F0D3861BB`.

Certificate SHA-256: `BE:C7:01:C7:22:53:A1:ED:BC:73:EC:38:60:A7:56:84:0E:A8:A3:46:80:89:1C:FE:AA:96:C9:B2:79:72:93:7B`.

The permanent private key and passwords are not included in this branch.
