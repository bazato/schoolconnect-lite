\connect schoolconnect_read

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS consumed_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(120) NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS read_posts (
  post_id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  class_id uuid,
  post_type varchar(30) NOT NULL,
  status varchar(30) NOT NULL,
  published_at timestamptz,
  scheduled_for timestamptz,
  revision_number integer NOT NULL,
  title varchar(150) NOT NULL,
  body text NOT NULL,
  subject_code varchar(60),
  exam_name varchar(150),
  due_date date,
  urgent boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS read_posts_teacher_idx ON read_posts (school_id, author_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS read_posts_school_idx ON read_posts (school_id, published_at DESC);

CREATE TABLE IF NOT EXISTS read_post_recipients (
  post_id uuid NOT NULL REFERENCES read_posts(post_id) ON DELETE CASCADE,
  school_id uuid NOT NULL,
  guardian_user_id uuid NOT NULL,
  student_id uuid NOT NULL,
  PRIMARY KEY (post_id, guardian_user_id, student_id)
);
CREATE INDEX IF NOT EXISTS read_post_recipients_guardian_idx ON read_post_recipients (school_id, guardian_user_id, student_id);

CREATE TABLE IF NOT EXISTS read_attendance (
  school_id uuid NOT NULL,
  class_id uuid NOT NULL,
  student_id uuid NOT NULL,
  attendance_date date NOT NULL,
  event_id uuid NOT NULL,
  attendance_status varchar(30) NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (school_id, student_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS read_attendance_school_idx ON read_attendance (school_id, attendance_date DESC);
