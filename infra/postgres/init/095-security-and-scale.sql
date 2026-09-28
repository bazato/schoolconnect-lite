\connect schoolconnect_identity

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS active_membership_id uuid REFERENCES memberships(id);
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES invitations(id);
UPDATE auth_sessions s
SET active_membership_id = (
  SELECT m.id FROM memberships m
  WHERE m.user_id = s.user_id AND m.status = 'ACTIVE'
  ORDER BY m.created_at LIMIT 1
)
WHERE active_membership_id IS NULL;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  token_family_id uuid NOT NULL,
  token_hash varchar(128) NOT NULL UNIQUE,
  replaced_by_token_id uuid REFERENCES auth_refresh_tokens(id),
  used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_refresh_tokens_session_idx
  ON auth_refresh_tokens (session_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS auth_refresh_tokens_family_idx
  ON auth_refresh_tokens (token_family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope varchar(40) NOT NULL,
  subject_hash varchar(128) NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_cleanup_idx ON auth_rate_limits (updated_at);

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS invitations_active_phone_idx
  ON invitations (phone_hash, expires_at) WHERE accepted_at IS NULL AND revoked_at IS NULL;

\connect schoolconnect_school

CREATE INDEX IF NOT EXISTS enrollments_roster_idx ON enrollments (school_id, class_id, status, student_id);
CREATE INDEX IF NOT EXISTS guardian_links_student_idx ON guardian_links (school_id, student_id, status, guardian_user_id);

\connect schoolconnect_content

CREATE TABLE IF NOT EXISTS post_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  class_id uuid NOT NULL,
  post_type varchar(30) NOT NULL CHECK (post_type IN ('HOMEWORK','RESULT','ANNOUNCEMENT')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,author_membership_id,class_id,post_type)
);
CREATE INDEX IF NOT EXISTS post_drafts_author_idx ON post_drafts (school_id,author_membership_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_page_idx ON posts (school_id, author_membership_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS post_recipients_timeline_idx ON post_recipients (school_id, guardian_user_id, student_id, post_id);

\connect schoolconnect_attendance

CREATE UNIQUE INDEX IF NOT EXISTS absence_responses_guardian_event_idx
  ON absence_responses (attendance_event_id, guardian_user_id);
CREATE INDEX IF NOT EXISTS attendance_followup_idx
  ON attendance_events (school_id, class_id, attendance_date, attendance_status);

\connect schoolconnect_notifications

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_source_event_id_recipient_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_recipient_student_uidx
  ON notifications (source_event_id, recipient_user_id, student_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS notifications_cursor_idx
  ON notifications (school_id, recipient_user_id, created_at DESC, id DESC);
