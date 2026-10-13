# Nexqon School App — Android trial

Standalone Android preview version **0.1.1**, build **2**, with the custom Nexqon launcher and startup icon.

[Download the APK](https://github.com/bazato/schoolconnect-lite/raw/refs/heads/android-apk-nexqon-0.1.1/nexqon-school-app-android-preview-2026-10-13.apk)

Built from application source commit `45fcbc8edb613c59326beba4bbf2c950b74cc330`. This branch contains only downloadable artifacts; application source remains on `main`.

- Android package: `com.schoolconnect.lite`, unchanged from earlier previews.
- Android 7.0 or newer, ARM64 and ARMv7 phones.
- Same preview signing certificate as the previous build; install as an update rather than uninstalling.
- Uses the existing Render trial API. Mock trial OTP remains `123456` when enabled by the server.
- This is debug-signed test software, not a production Play Store release. Use synthetic test data only.

Enable permission to install from your browser when Android prompts. You do not need Expo Go, a tunnel, or a computer running Metro.
