\connect schoolconnect_school

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_code varchar(40) NOT NULL UNIQUE,
  display_name varchar(200) NOT NULL,
  timezone varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE school_configurations (
  school_id uuid PRIMARY KEY REFERENCES schools(id),
  attendance_edit_window_hours integer NOT NULL DEFAULT 24 CHECK (attendance_edit_window_hours >= 0),
  guardian_ack_policy varchar(30) NOT NULL DEFAULT 'ANY_GUARDIAN' CHECK (guardian_ack_policy IN ('ANY_GUARDIAN', 'ALL_GUARDIANS')),
  result_release_policy varchar(40) NOT NULL DEFAULT 'STUDENT_PRIVATE_ONLY' CHECK (result_release_policy IN ('STUDENT_PRIVATE_ONLY', 'APPROVED_CLASS_PUBLIC')),
  allowed_file_types text[] NOT NULL DEFAULT ARRAY['application/pdf','image/jpeg','image/png'],
  max_file_bytes bigint NOT NULL DEFAULT 20971520 CHECK (max_file_bytes > 0),
  max_files_per_post smallint NOT NULL DEFAULT 5 CHECK (max_files_per_post > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE school_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  class_code varchar(40) NOT NULL,
  display_name varchar(120) NOT NULL,
  academic_year varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, class_code, academic_year)
);

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  admission_number varchar(80) NOT NULL,
  display_name varchar(160) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'GRADUATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_number),
  UNIQUE (school_id, id)
);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  class_id uuid NOT NULL REFERENCES school_classes(id),
  student_id uuid NOT NULL REFERENCES students(id),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  started_on date NOT NULL,
  ended_on date,
  UNIQUE (class_id, student_id, started_on)
);
CREATE INDEX enrollments_active_class_idx ON enrollments (school_id, class_id, status);

CREATE TABLE guardian_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  guardian_user_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id),
  relationship varchar(40),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  UNIQUE (school_id, guardian_user_id, student_id)
);
CREATE INDEX guardian_links_active_idx ON guardian_links (school_id, guardian_user_id, status);

CREATE TABLE teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  teacher_membership_id uuid NOT NULL,
  class_id uuid NOT NULL REFERENCES school_classes(id),
  subject_code varchar(60) NOT NULL,
  subject_name varchar(120) NOT NULL,
  can_publish_results boolean NOT NULL DEFAULT false,
  can_publish_announcements boolean NOT NULL DEFAULT false,
  can_record_attendance boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  UNIQUE (teacher_membership_id, class_id, subject_code)
);
CREATE INDEX teacher_assignments_scope_idx ON teacher_assignments (school_id, teacher_membership_id, status);

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
CREATE INDEX school_outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;
