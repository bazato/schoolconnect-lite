\connect schoolconnect_identity

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS display_name_override varchar(160);
CREATE INDEX IF NOT EXISTS memberships_school_role_status_idx ON memberships (school_id, role, status);

\connect schoolconnect_school

ALTER TABLE school_classes ADD COLUMN IF NOT EXISTS grade_code varchar(40);
ALTER TABLE school_configurations ADD COLUMN IF NOT EXISTS scheduled_announcements_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE school_configurations ADD COLUMN IF NOT EXISTS school_wide_announcements_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE school_configurations ADD COLUMN IF NOT EXISTS grade_wide_announcements_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS can_publish_school_wide boolean NOT NULL DEFAULT false;
ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS can_publish_grade_wide boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_one_active_student_idx ON enrollments (school_id, student_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS school_classes_grade_idx ON school_classes (school_id, grade_code, status);

\connect schoolconnect_content

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (status IN ('DRAFT','UPLOADING','READY','SCHEDULED','PUBLISHED','UPDATED','ARCHIVED'));
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
CREATE INDEX IF NOT EXISTS posts_due_schedule_idx ON posts (scheduled_for) WHERE status='SCHEDULED';

\connect schoolconnect_attendance

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS review_note text;
CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_event_guardian_idx ON leave_requests (attendance_event_id, guardian_user_id);
