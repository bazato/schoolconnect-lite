\connect schoolconnect_identity

-- Account-level credential shared by web/mobile and all memberships. Never plaintext.
ALTER TABLE users ADD COLUMN IF NOT EXISTS passcode_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS passcode_set_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS passcode_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS passcode_locked_until timestamptz;

-- OTP verification grants only short-lived credential setup, not application access.
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS purpose varchar(20) NOT NULL DEFAULT 'ACTIVATE' CHECK (purpose IN ('ACTIVATE','RESET'));
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS setup_token_hash varchar(128);
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS setup_expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS otp_setup_token_idx ON otp_challenges (setup_token_hash) WHERE setup_token_hash IS NOT NULL;
