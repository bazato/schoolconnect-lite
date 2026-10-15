# Permanent Android signing

Version 0.1.3 / Android versionCode 4 introduces a permanent private signing identity. It does not turn the mock-OTP backend into an approved production environment.

## Key custody

`scripts/android-release.ps1 -Action Initialize` creates a 3072-bit RSA PKCS12 keystore under `%USERPROFILE%\.nexqon-signing`, outside Git. It refuses to replace an existing directory. Only the current Windows account and SYSTEM receive access. The random password is saved with Windows DPAPI using Export-Clixml; no password is printed, committed, or passed on the command line. The public certificate may be shared; the keystore and password must not be.

**This is local custody, not a disaster-recovery backup.** DPAPI credentials cannot simply be moved to a different Windows machine/account. The owner must securely save the keystore and its password separately in an encrypted offline backup/password manager. Never send credentials in chat or upload them to GitHub. Losing the key/password can prevent updates to directly distributed APKs. When publishing to Google Play, explicitly plan Play App Signing, the upload key, and compatibility with sideloaded installations; a different Play signing certificate will not directly update these installations.

## Reproducible Windows build

Use a fresh short build directory (for example `C:\nx-build-<id>`) with a copy of the source. Do not copy .git, .env files, signing material, generated native directories, dependencies, or private migration files. In that build copy only, add `nodeLinker: hoisted` to pnpm-workspace.yaml to avoid Windows native path limits. Then run:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @schoolconnect/mobile exec expo prebuild --platform android --no-install
# Invoke the original repository's script with the isolated build directory:
& C:\Documents\schoolapp\scripts\android-release.ps1 -Action Build -BuildDirectory C:\nx-build-<id>
```

The script rejects historical native trees without the signing plugin before loading credentials, injects signing credentials into the Gradle child process, and restores its process environment afterward. It uses a single-use Gradle daemon and in-process Kotlin compilation to avoid leaving a persistent compiler daemon holding the signing environment. It verifies the resulting APK against the protected public certificate. Avoid Gradle debug logs/build scans and never publish generated build directories. The Expo plugin `with-release-signing.cjs` persists configuration through prebuild, removes debug signing from release, and rejects release tasks without a key, an explicit HTTPS API URL, and disabled client demo mode. Debug builds still work without the permanent key.

Build output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. Verify using Android build-tools `apksigner verify --verbose --print-certs`, `zipalign -c -P 16 4`, and `aapt dump badging`. Compare the public certificate fingerprint with the permanent certificate and confirm versionCode/package. Native device installation and application workflows are separate acceptance checks.

Existing 0.1.2 debug-signed installations cannot be updated by this new key: sync drafts first, uninstall the old app, install 0.1.3, and sign in again. Uninstalling removes local sessions/drafts/cache; server records are unchanged. Future APK updates must retain this identity and increment versionCode.

## Public certificate pin (created 15 October 2026)

Subject: `CN=Nexqon School App, O=Nexqon`. SHA-256 fingerprint:

`BE:C7:01:C7:22:53:A1:ED:BC:73:EC:38:60:A7:56:84:0E:A8:A3:46:80:89:1C:FE:AA:96:C9:B2:79:72:93:7B`

This public fingerprint is not a password. Compare every subsequent release APK against it before distributing. Key validity ends 2 March 2054. No private signing files are stored in this repository.

The current API is `https://schoolconnect-demo-api.onrender.com/api/v1`. OTP is mocked (`123456`), attachments are disabled, and production latency/monitoring/store/device acceptance remain open. Do not call this artifact a full production sign-off.
