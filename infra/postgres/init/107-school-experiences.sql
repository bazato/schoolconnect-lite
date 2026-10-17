\connect schoolconnect_attendance

-- Standalone applications do not alter attendance or legacy absence notes.
CREATE TABLE IF NOT EXISTS parent_leave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
  class_id uuid NOT NULL, student_id uuid NOT NULL, guardian_user_id uuid NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL CHECK (end_date >= start_date),
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 2000),
  status varchar(30) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','ACKNOWLEDGED')),
  acknowledged_by_membership_id uuid, acknowledged_at timestamptz,
  acknowledgement_note varchar(1000), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='ACKNOWLEDGED') = (acknowledged_at IS NOT NULL)),
  UNIQUE (school_id, student_id, guardian_user_id, start_date, end_date)
);
CREATE INDEX IF NOT EXISTS parent_leave_class_idx ON parent_leave_applications(school_id,class_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS parent_leave_student_idx ON parent_leave_applications(school_id,student_id,created_at DESC,id);

\connect schoolconnect_content

CREATE TABLE IF NOT EXISTS class_timetables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, class_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0), title varchar(160) NOT NULL,
  slots jsonb NOT NULL CHECK (jsonb_typeof(slots)='array'),
  published_by_membership_id uuid NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,class_id,version)
);
CREATE INDEX IF NOT EXISTS class_timetable_latest_idx ON class_timetables(school_id,class_id,version DESC);
CREATE TABLE IF NOT EXISTS result_scores (
  post_id uuid PRIMARY KEY REFERENCES posts(id), school_id uuid NOT NULL,
  class_id uuid NOT NULL, student_id uuid NOT NULL,
  exam_name varchar(160) NOT NULL, subject_name varchar(160) NOT NULL,
  marks_obtained numeric(10,2) NOT NULL CHECK (marks_obtained >= 0),
  max_marks numeric(10,2) NOT NULL CHECK (max_marks > 0 AND marks_obtained <= max_marks),
  result_date date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS result_scores_child_idx ON result_scores(school_id,student_id,result_date,created_at);
CREATE INDEX IF NOT EXISTS result_scores_class_idx ON result_scores(school_id,class_id,exam_name,subject_name);
