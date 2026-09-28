\connect schoolconnect_school

ALTER TABLE school_configurations ADD COLUMN IF NOT EXISTS urgent_announcements_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS can_publish_urgent boolean NOT NULL DEFAULT false;
