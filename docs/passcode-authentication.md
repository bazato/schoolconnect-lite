# First-time OTP and four-digit account passcode

Implemented and verified locally on 13 October 2026. Release status is recorded in the release note; implementation verification alone does not confirm cloud deployment.

## User journey

The web portal and the one Teacher/Parent mobile app use the same Identity account credential. A user signs in with their registered E.164 mobile number (for example +91 followed by the number) and a **four-digit passcode**, including leading zeros if chosen. This is not a device-only unlock code.

On first login, choose **First login / set up passcode**. Enter the school invitation and request OTP. Verify the six-digit OTP, then choose and confirm the four-digit passcode. OTP verification does not itself issue an application session. Once setup succeeds, the invitation is accepted and a normal session is created atomically. Future login shows neither invitation nor OTP fields.

Users already activated under the earlier OTP-only system use that same setup option, leaving the invitation blank. Their existing memberships and school/guardian relationships are preserved. Setup signs out any earlier sessions. A subsequent logout or session expiry takes them to passcode sign-in. Existing logged-in users are not immediately forced out by the additive database migration; their next sign-in requires setup if they have no passcode.

**Forgot passcode?** requests an explicit recovery OTP without invitation. Successful recovery replaces the passcode, clears account lockout, revokes all earlier sessions, and invalidates older recovery grants. It creates a fresh session on the requesting device. School/role permissions remain unchanged. Additional children use the existing parent identity, not separate credentials.

The administrative portal still accepts only Owner/School Administrator roles. Teacher/Parent accounts use mobile. This feature does not broaden role access.

## Endpoints

| Public gateway endpoint | Meaning |
| --- | --- |
| POST /api/v1/auth/otp/request | phoneE164, optional invitationCode, purpose ACTIVATE (default) or RESET |
| POST /api/v1/auth/otp/verify | challengeId, six-digit code; returns setupToken, nextStep SET_PASSCODE, expiry 300 seconds; **no app tokens** |
| POST /api/v1/auth/passcode/setup | setupToken, four-digit passcode, deviceId; returns the established access/refresh session shape |
| POST /api/v1/auth/passcode/login | phoneE164, four-digit passcode, deviceId; returns the same session shape |

Refresh, logout, role/school switching and the centralized authorization service remain in place. Credential verification is confined to Identity; clients cannot verify locally or bypass it with a setup token. The gateway forwards the public authentication requests to Identity and applies the authentication rate limit.

## Storage and concurrency

Migration **infra/postgres/init/103-passcode-auth.sql** extends `users` with passcode_hash, passcode_set_at, passcode_failed_attempts and passcode_locked_until. It extends `otp_challenges` with purpose, setup_token_hash and setup_expires_at. No new tables, copied identities or cross-service credentials are introduced; the application table count remains 53.

Passcodes are never stored in plaintext: PBKDF2-HMAC-SHA256 (600,000 iterations), random salt and an HMAC server pepper protect the verifier. Set a stable, separate PASSCODE_PEPPER in protected Identity configuration; for compatibility with the existing trial, AUTH_JWT_SECRET is the fallback. Changing either effective pepper makes stored passcodes unusable; plan OTP resets before rotation. No passcode is persisted on the mobile device or in web storage; the existing session tokens are stored as before.

The setup token is random, hash-stored, short-lived and single-use. OTP consumption and grant issuance use a challenge row lock. Credential creation/reset, invitation acceptance, session revocation and new session creation occur in one Identity transaction. Target membership, invitation validity and grant expiry are rechecked at setup. Account row locks serialize simultaneous login failures, so concurrent requests cannot bypass the attempt count. Concurrent setup with the same grant permits only one success. Older reset grants are rejected using the credential-set timestamp, avoiding cross-grant lock deadlocks.

Defaults: PASSCODE_MAX_ATTEMPTS=5, PASSCODE_LOCK_SECONDS=900, PASSCODE_LOGIN_LIMIT=30 per phone per 15 minutes. OTP request/verification limits remain. Gateway API_AUTH_RATE_LIMIT applies to all /auth endpoints. Expired lockout allows another attempt; successful authentication clears failures. Four KDF operations maximum execute concurrently per Identity process to bound CPU work. Unknown account/wrong passcode login responses share PHONE_OR_PASSCODE_INVALID. Administrators do not see the passcode.

## Trial limitations and deployment

OTP remains **mocked 123456**, visibly labelled as trial-only; no SMS provider was added. Anyone knowing a registered phone and this mock OTP could use recovery to reset its passcode. Therefore this is **not production-safe authentication**, even though normal logins now require passcodes. A four-digit passcode has only 10,000 possibilities and should not be presented as equivalent to a strong password or MFA. Production requires a real possession-verifying OTP provider, TLS, protected stable secrets, rate monitoring, and a review of whether a four-digit account credential is acceptable for privileged administrators.

The offline UI-demo mode remains explicitly simulated; it does not exercise Identity. Connected builds must use EXPO_PUBLIC_DEMO_MODE=false.

Deployment must include Identity + gateway + portal together and run migration 103. The Render demo migrator now includes it automatically. **Older APKs expecting OTP verification to return accessToken are incompatible and need replacement.** Build/install the new mobile binary before switching users to the new backend. No previous PDF documentation is silently regenerated; it describes the earlier OTP-only baseline and should be read with this authentication addendum.

## Verification

Identity crypto unit tests and explicit localhost PostgreSQL integration tests cover first activation, OTP/grant replay, legacy activated users, shared web/mobile credential and multiple memberships, concurrent setup, concurrent wrong attempts and lock expiry, reset/session revocation, stale recovery grants, grant expiry and revoked invitations/memberships. Web component tests cover login, activation, matching confirmation and recovery. Mobile API tests verify the same contracts, grant separation and recovery purpose. Gateway tests verify Identity forwarding without requiring an existing session.

Run the Docker integration suite explicitly in PowerShell:

```powershell
$env:PASSCODE_DB_TEST_URL='postgresql://schoolconnect:schoolconnect@127.0.0.1:5432/schoolconnect_identity'
pnpm --filter @schoolconnect/identity test
```

It uses temporary synthetic accounts and removes those accounts afterward. Existing regression helpers now support passcode sign-in and first-time setup; TEST_LOGIN_PASSCODE defaults to 8642 for synthetic local test identities, not a production default credential. They never reset a pre-existing credential automatically.

### Completed checks (13 October 2026)

- Full workspace lint and typecheck: passed.
- Full workspace unit/component suite: 237 passed; the 7 Identity and 7 Fees DB tests are opt-in and skipped by this default command.
- Explicit Identity PostgreSQL suite: all 7 passed (26 Identity tests including its unit tests), including OTP verified after a prior reset and rejected stale grant.
- Render migration packaging tests: all 3 passed.
- Full workspace builds: passed, including portal and Expo web export; Android and iOS Hermes bundle exports also passed. These exports are not signed APK/IPA files.
- Eight integration security/concurrency stages, ten product workflow stages, and administrator/mobile regressions: passed using the new login helper.
- Fee import/query regression: passed, including 100 concurrent reads (2,719 ms in this local run).
- General API read load: 100 simulated users, 500 requests, zero failures; p95 1,813 ms and p99 1,928 ms locally. This is not a production SLA or a measurement of 100 simultaneous passcode verifications.

The local Docker migration was applied without removing tables or modifying existing passcodes. Regression scripts created/retained their usual synthetic schools and accounts; only the dedicated Identity test fixtures were removed. No cloud environment or published APK was changed.
