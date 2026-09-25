\connect schoolconnect_content

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  class_id uuid,
  post_type varchar(30) NOT NULL CHECK (post_type IN ('HOMEWORK', 'RESULT', 'ANNOUNCEMENT')),
  status varchar(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'UPLOADING', 'READY', 'PUBLISHED', 'UPDATED', 'ARCHIVED')),
  current_revision_number integer NOT NULL DEFAULT 1 CHECK (current_revision_number > 0),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_school_status_idx ON posts (school_id, status, published_at DESC);
CREATE INDEX posts_class_type_idx ON posts (school_id, class_id, post_type, published_at DESC);

CREATE TABLE post_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title varchar(150) NOT NULL,
  body text NOT NULL,
  subject_code varchar(60),
  exam_name varchar(150),
  due_date date,
  audience_type varchar(30) NOT NULL CHECK (audience_type IN ('CLASS', 'GRADE', 'SCHOOL', 'STUDENT')),
  urgent boolean NOT NULL DEFAULT false,
  change_kind varchar(20) NOT NULL DEFAULT 'MATERIAL' CHECK (change_kind IN ('MATERIAL', 'MINOR')),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, revision_number)
);

CREATE TABLE post_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  guardian_user_id uuid NOT NULL,
  recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, student_id, guardian_user_id)
);
CREATE INDEX post_recipients_guardian_idx ON post_recipients (school_id, guardian_user_id, post_id);

CREATE TABLE post_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_revision_id uuid NOT NULL REFERENCES post_revisions(id),
  file_id uuid NOT NULL,
  student_id uuid,
  privacy_classification varchar(40) NOT NULL CHECK (privacy_classification IN ('GENERAL', 'STUDENT_PRIVATE', 'APPROVED_CLASS_PUBLIC')),
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_revision_id, file_id, student_id)
);

CREATE TABLE post_views (
  post_id uuid NOT NULL REFERENCES posts(id),
  guardian_user_id uuid NOT NULL,
  student_id uuid NOT NULL,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  view_count integer NOT NULL DEFAULT 1 CHECK (view_count > 0),
  PRIMARY KEY (post_id, guardian_user_id, student_id)
);

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
CREATE INDEX content_outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;
