\connect schoolconnect_identity

ALTER TABLE memberships ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT'));
ALTER TABLE memberships ADD CONSTRAINT memberships_scope_check CHECK ((role = 'PLATFORM_OWNER' AND school_id IS NULL) OR (role <> 'PLATFORM_OWNER' AND school_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS memberships_platform_owner_user_idx ON memberships (user_id, role) WHERE role = 'PLATFORM_OWNER';

ALTER TABLE invitations ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT'));
ALTER TABLE invitations ADD CONSTRAINT invitations_scope_check CHECK ((role = 'PLATFORM_OWNER' AND school_id IS NULL) OR (role <> 'PLATFORM_OWNER' AND school_id IS NOT NULL));

ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES memberships(id);

\connect schoolconnect_school

CREATE UNIQUE INDEX IF NOT EXISTS schools_id_school_code_idx ON schools (id, school_code);
