\connect schoolconnect_files

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE file_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  owner_type varchar(30) NOT NULL CHECK (owner_type IN ('POST', 'LEAVE_REQUEST')),
  owner_id uuid NOT NULL,
  uploaded_by_user_id uuid NOT NULL,
  original_file_name varchar(255) NOT NULL,
  media_type varchar(100) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  checksum_sha256 char(64) NOT NULL,
  quarantine_object_key varchar(500) NOT NULL UNIQUE,
  private_object_key varchar(500) UNIQUE,
  processing_status varchar(30) NOT NULL DEFAULT 'QUARANTINED' CHECK (processing_status IN ('QUARANTINED', 'SCANNING', 'READY', 'REJECTED', 'DELETED')),
  rejection_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX file_objects_owner_idx ON file_objects (school_id, owner_type, owner_id);
CREATE INDEX file_objects_processing_idx ON file_objects (processing_status, created_at);

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES file_objects(id),
  multipart_upload_id varchar(300),
  status varchar(30) NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'UPLOADING', 'UPLOADED', 'EXPIRED', 'ABORTED')),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE file_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES file_objects(id),
  actor_user_id uuid NOT NULL,
  student_id uuid,
  access_mode varchar(30) NOT NULL CHECK (access_mode IN ('SIGNED_URL', 'AUTHENTICATED_STREAM')),
  decision varchar(20) NOT NULL CHECK (decision IN ('ALLOWED', 'DENIED')),
  decision_reason varchar(120),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_access_audit_idx ON file_access_events (school_id, file_id, occurred_at DESC);

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
CREATE INDEX files_outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;
