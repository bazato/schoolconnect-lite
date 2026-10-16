\connect schoolconnect_content
-- Teacher recipients are a publication-time snapshot, not cross-service foreign keys.
CREATE TABLE IF NOT EXISTS post_staff_recipients (
  post_id uuid NOT NULL REFERENCES posts(id),
  school_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY(post_id,user_id)
);
