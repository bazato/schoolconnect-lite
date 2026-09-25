\connect schoolconnect_attendance

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE attendance_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  class_id uuid NOT NULL,
  attendance_date date NOT NULL,
  submitted_by_membership_id uuid NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  committed_version integer NOT NULL CHECK (committed_version > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, class_id, attendance_date, committed_version)
);

CREATE TABLE attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES attendance_batches(id),
  school_id uuid NOT NULL,
  class_id uuid NOT NULL,
  student_id uuid NOT NULL,
  attendance_date date NOT NULL,
  attendance_status varchar(20) NOT NULL CHECK (attendance_status IN ('PRESENT', 'ABSENT', 'LATE', 'LEAVE')),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  recorded_by_membership_id uuid NOT NULL,
  correction_reason text,
  supersedes_event_id uuid REFERENCES attendance_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id, attendance_date, revision_number)
);
CREATE INDEX attendance_events_history_idx ON attendance_events (school_id, student_id, attendance_date, revision_number DESC);

CREATE TABLE attendance_current (
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  attendance_date date NOT NULL,
  current_event_id uuid NOT NULL UNIQUE REFERENCES attendance_events(id),
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, student_id, attendance_date)
);

CREATE TABLE absence_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  attendance_event_id uuid NOT NULL REFERENCES attendance_events(id),
  guardian_user_id uuid NOT NULL,
  response_type varchar(30) NOT NULL CHECK (response_type IN ('ACKNOWLEDGED', 'LEAVE_SUBMITTED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attendance_event_id, guardian_user_id, response_type)
);

CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  attendance_event_id uuid NOT NULL REFERENCES attendance_events(id),
  student_id uuid NOT NULL,
  guardian_user_id uuid NOT NULL,
  reason text,
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leave_requests_review_idx ON leave_requests (school_id, status, created_at);

CREATE TABLE idempotency_keys (
  actor_id uuid NOT NULL,
  operation varchar(80) NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(128) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation, idempotency_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(120) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0
);
CREATE INDEX attendance_outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;
