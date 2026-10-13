# Nexqon School App — Android preview 0.1.2

This branch distributes the standalone Android trial APK. Application source is on `main`.

Source: [07d9ae85abc251ceadd2df5550cef2080ac0e89a](https://github.com/bazato/schoolconnect-lite/commit/07d9ae85abc251ceadd2df5550cef2080ac0e89a).

First-time sign-in uses your school invitation and six-digit verification OTP, then asks you to choose and confirm a **four-digit passcode**. Existing activated accounts set up their passcode once without an invitation. Later logins use your registered mobile number and chosen passcode. Recovery uses OTP and revokes previous sessions.

The trial OTP is still mocked as **123456**, not sent by SMS. Do not enter real student information. Account recovery with a shared mock OTP is not production-safe.

The APK connects to `https://schoolconnect-demo-api.onrender.com/api/v1`. No Expo Go, development tunnel or Metro server is required. School administrator/owner management remains available in the web portal; teacher and parent use this one mobile app.

## Install

Download `nexqon-school-app-0.1.2-passcode.apk` from this branch and open it on your Android phone. If prompted, allow installation from the browser/file manager. It uses the existing application ID and preview signing certificate, so it should update preview 0.1.1 without uninstalling. Back up any pending offline work before installing. The older APK is incompatible with the new OTP setup response; use this version.

This is a debug-certificate-signed preview, not a Play Store release. Android 7.0+ and ARM64/ARMv7 phones are supported. A physical-device installation and user acceptance test are still needed.

## Verified artifact

- Gradle `app:assembleRelease` and Android release lint checks succeeded on 13 October 2026.
- Application: `com.schoolconnect.lite`, versionName `0.1.2`, versionCode `3`.
- File: `nexqon-school-app-0.1.2-passcode.apk`, 45,628,066 bytes.
- Signature verification passed (APK v2); signing-certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching preview 0.1.1.
- Packaged bundle includes the hosted Render API and `/auth/passcode/login` + `/auth/passcode/setup`.
- APK SHA-256: `54abef95970f21cc8389d9a8ea890bbdbddb724a6c95fc435626f05d79897747`.
- Render automatically deployed source commit `07d9ae85abc251ceadd2df5550cef2080ac0e89a` to API and portal. The new passcode endpoint responds; all ten backend health checks passed. No real account credentials were changed for this release check.

[Download the APK](https://raw.githubusercontent.com/bazato/schoolconnect-lite/refs/heads/android-apk-nexqon-0.1.2/nexqon-school-app-0.1.2-passcode.apk)
