# Android 0.1.4 / versionCode 5 — result composer regressions

## Causes and fixes

- Existing native encrypted drafts store a v1 AES-GCM combined envelope as base64. Expo Crypto 57.0.3's JavaScript declaration permits strings in `AESSealedData.fromCombined`, but its Android Kotlin method expects `ByteArray`. Decode the envelope into `Uint8Array` before crossing that bridge. Keep the format, per-user encryption key and existing stored data unchanged. Failed restoration no longer marks the draft ready for autosave, so an unreadable draft cannot be silently replaced with empty fields; the UI does not print ciphertext/native stack traces.
- React Native's Blob implementation does not consistently provide browser `arrayBuffer()`. Native picked files now use Expo FileSystem `File.bytes()`, pass a typed array into SHA-256, and upload those same bytes through Expo fetch. Browser File handling remains separate. Size is checked using both picker metadata and actual bytes; upload completion must return the same file ID with READY status.
- School names no longer use widely spaced eyebrow typography. Long school/header/student names have bounded, shrinkable layouts. Audience text can shrink rather than forcing its neighboring label off-screen. These are layout constraints verified by component properties, not a claim of physical-device visual QA.
- Files exposes a lightweight authenticated internal capabilities response. Gateway `GET /api/v1/files/capabilities` delegates to Files; route permissions remain in the configurable Authorization service. The size/media limits come from the same policy used by upload validation. No per-screen polling, schema migration, storage enablement or credential changes were added.
- The composer checks file availability, shows checking/disabled/unreachable states with manual retry, and blocks file-based result publication when storage is unavailable. Text-only homework/announcements can still publish. Upload errors become safe user-facing messages.

## Verification

Before the native release: mobile lint/typecheck and 56 tests passed; API 142, Authorization 18 and Files 6 tests passed. All three changed backend services passed lint/typecheck/build; five release-signing tests passed. API error output from the deliberate STUDENT_CREATE_FAILED compensation test is an expected injected failure, not a live deployment error.

The encryption regression tests exercise actual AES-GCM with strict Android-style byte-array input, existing v1 envelopes, saved-key reimport, Unicode, wrong-user/tamper rejection and legacy migration. Upload tests exercise native byte reads and binary checksums, web File handling, size/media rejection, failed PUT and non-ready scan states. Native SDK functions and S3 transport are contract doubles in these unit tests; this does not assert an actual Android/R2 end-to-end upload.

## Delivery and open gates

Use the same permanent certificate introduced in 0.1.3. Version 0.1.4 can update that installation without uninstalling it; retain drafts/login data. Keep private signing material outside Git. This release does not fix the separate production scanner/storage gate: hosted uploads remain disabled until secure scanning and file validation are implemented and tested. Do not replace a real scanner with an always-clean development implementation.

No phone is connected through ADB. Physical result-screen, picker and large-font/narrow-screen acceptance must still be performed on a device. Native build, Render live verification and the public artifact checksum are recorded in the local release handoff after completion.
