# Nexqon School App 0.1.7 — Android APK

Standalone signed trial build. Android 7.0 (API 24) or newer; ARM64 and 32-bit ARM.

- Package: `com.schoolconnect.lite`
- Version: `0.1.7`; Android versionCode: `8`
- Source commit: `a528ad8ac7f2cffae64a9c12af73b83fdf5a1134`
- API: `https://schoolconnect-demo-api.onrender.com/api/v1`
- Existing permanent Nexqon signing identity, not the Android debug key.
- Backend OTP remains mocked (`123456`). This is not production or Play Store approval.

The build includes verified-workspace sign-in, leave applications, timetables, result charts and updated private-upload handling. Server uploads are scanned by Cloudmersive and stored privately in R2. Limits and free-trial availability apply.

No private signing keys, passwords, scanner keys or database credentials are included in this distribution branch.

Physical-device acceptance and a full authenticated teacher-to-parent flow remain separate tests.

## Verified artifact

- APK size: 45,722,014 bytes
- SHA-256: `6eaa224730eea395a6d8009e7df033da32944cdba70fc25628e850ef509dc7a9`
- Signing certificate SHA-256: `bec701c72253a1edbc73ec3860a756840ea8a34680891cfeaa96c9b27972937b`
- Android APK Signature Scheme v2 verified; release is not debuggable. 16 KB native-library ZIP alignment check passed.
- Mobile unit tests: 91 passed; typecheck/lint passed; five signing-safety tests passed; native release build passed.
