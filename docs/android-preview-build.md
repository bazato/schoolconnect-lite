# Android preview APK

The installable test APK is built from `apps/mobile` with Expo SDK 57 and Android Studio's SDK. Its application ID is `com.schoolconnect.lite` and it supports Android 7.0 (API 24) or newer. The bundle embeds `EXPO_PUBLIC_API_URL` at build time, so changing `apps/mobile/.env` requires a new APK.

For the disposable Render trial, set `apps/mobile/.env` to:

```dotenv
EXPO_PUBLIC_DEMO_MODE=false
EXPO_PUBLIC_API_URL=https://schoolconnect-demo-api.onrender.com/api/v1
```

The local Windows build uses a short temporary checkout with pnpm's `nodeLinker: hoisted`. The regular repository path plus pnpm's isolated dependency paths exceeds Windows' 260-character limit during CMake compilation. In the temporary checkout, add `nodeLinker: hoisted` to `pnpm-workspace.yaml`, then run:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @schoolconnect/mobile exec expo prebuild --platform android --no-install
Set-Location apps/mobile/android
$env:NODE_ENV = 'production'
.\gradlew.bat app:assembleRelease --no-daemon --max-workers=2 --console=plain
```

The output is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. Copy it to `dist-native/` in the main repository. The generated `android/` directory and the APK are intentionally Git-ignored; regenerate them from the Expo config.

This is a standalone **preview** APK, not a Play Store artifact. Expo's generated release configuration signs it with the Android debug certificate. Before production distribution, configure a persistent private signing key, increment `versionCode`, provision a durable backend and file storage, and build a store-ready AAB. Never enter real student data into the disposable Render trial.
