# Nexqon School App branding

The public-facing name is **Nexqon School App**. Mobile launcher, welcome screen, school-name fallback, portal branding, browser title and favicon use this name and the custom purple-and-white education/family mark.

## Compatibility

Android application ID and iOS bundle ID remain `com.schoolconnect.lite`; the Expo slug and deep-link scheme remain unchanged. API routes, accounts, membership IDs, persistent storage keys and backend services have not been renamed. Version 0.1.1 / Android versionCode 2 advances the preview build without creating a separate application.

## Assets and generation

- `apps/mobile/assets/nexqon-icon.png`: selected opaque launcher artwork, also used for the adaptive foreground and splash image. The solid purple field and centered mark keep the symbol safe under launcher masks.
- `apps/web/public/nexqon-icon.png`: identical copy for portal logos and browser favicon.

Mode: built-in image-generation tool, not an external API script.

Final generation prompt: Create an original square education-and-connection logo for a teacher-parent school application: a crisp white open book, graduation cap, and integrated family motif; a centered geometric silhouette with generous margins on an edge-to-edge royal-purple #5D08C9 background. No words, initials, watermark, border, mockup, shadow or extra decoration. The request initially used the previous brand name, but the artwork intentionally contains no text and therefore supports the requested Nexqon name unchanged.

A transparent-background edit was inspected and rejected because it introduced edge/noise artifacts. Only the clean original was integrated; the rejected variant is not a project asset.

## Validation and delivery

Mobile and web lint, typecheck, unit tests and portal production build pass (32 mobile and 10 portal tests, including branding regressions). Expo prebuild produces `app_name=Nexqon School App`, custom launcher resources, and an adaptive launcher definition. The SDK-compatible `expo-splash-screen` config plugin replaces Expo's default startup image with the custom logo; the legacy splash property alone did not update native resources. See [Expo splash-screen configuration](https://docs.expo.dev/versions/latest/sdk/splash-screen/). APK signature and packaged label/version must be verified after the native build finishes.

The APK is a standalone Render-connected trial build, still debug-signed, not a Play Store production release. OTP remains the configured mock trial OTP; changing the brand does not change authentication.

## Verified Android artifact

- Source commit: `45fcbc8edb613c59326beba4bbf2c950b74cc330`.
- Build: Gradle `app:assembleRelease` succeeded, including Android release lint checks.
- File: `dist-native/nexqon-school-app-android-preview-2026-10-13.apk`, 45,624,150 bytes.
- Label: `Nexqon School App`; versionName `0.1.1`, versionCode `2`.
- Android 7.0+; ARM64 and ARMv7 phone architectures (not x86 emulators).
- APK signature verification passed. Signing-certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` matches the previous preview.
- APK SHA-256: `DA32379D44831BF235D227FC718DDF967CF7B11E8B2AE1D3A90F42959914660D`.
- The packaged bundle contains the existing Render API URL; no Metro server or Expo tunnel is needed.
- GitHub artifact branch: `android-apk-nexqon-0.1.1`, isolated from application source on `main`.
- Render reported successful portal and API deployments of source commit `45fcbc8`. Direct portal HTTP inspection encountered a Cloudflare browser challenge, so deployment status is the confirmation source, not a claimed visual browser test.

Native launcher and splash resources were visually inspected; the rebuilt APK has not been installed and exercised on a physical phone during this task.
