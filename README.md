# Nexqon School App — Android 0.1.3

Permanently signed release candidate for the hosted trial. This is not a real-school production sign-off: OTP remains mocked, document attachments are disabled pending secure scanning, and performance/monitoring/device/store acceptance remain open.

## Download

[Download Android APK](https://raw.githubusercontent.com/bazato/schoolconnect-lite/refs/heads/android-apk-nexqon-0.1.3/nexqon-school-app-0.1.3-release.apk)

Android package: `com.schoolconnect.lite`; version: `0.1.3`; versionCode: `4`; label: **Nexqon School App**. Android 7.0/API 24 or later; ARM 32-bit and ARM64 phone architectures. No Expo Go or development tunnel is required. The app connects to the hosted HTTPS API.

## Important installation change

This build uses a new permanent certificate, not the old Android debug certificate. Existing testers must sync unsent drafts, uninstall the old debug-signed app, install this APK, and sign in again. Uninstalling removes local drafts, sessions and cache; server-side school records, accounts, fees and posts are unaffected. Do not uninstall until unsynced work is safe.

Future directly distributed APK updates will use this permanent signing identity and a higher versionCode. No private signing key or credentials are included here.

## Verification

APK SHA-256: `A1C33A3BFB58B52E2FEF66239D7F1BD97159DC0CD301F393E98E2A88B494816E`.

Size: 45,632,182 bytes (about 43.5 MiB). APK Signature Scheme v2 verification and 16 KiB native-library ZIP alignment checks passed. Package/version/label/ABI checks passed, the app is not marked debuggable, and the packaged JavaScript contains the correct hosted API address.

Signing certificate subject: `CN=Nexqon School App, O=Nexqon`.

Certificate SHA-256: `BE:C7:01:C7:22:53:A1:ED:BC:73:EC:38:60:A7:56:84:0E:A8:A3:46:80:89:1C:FE:AA:96:C9:B2:79:72:93:7B`.

Mobile typecheck/lint, 35 mobile tests and five signing-configuration tests passed. Native signature, alignment and package checks are performed before upload. Physical-device installation and workflow testing remain pending; no connected phone was available during this build.
