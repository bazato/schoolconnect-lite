#!/bin/sh
# Runs only when the PostgreSQL data volume is first initialized.
set -eu

validate_password() {
  if [ "${#1}" -lt 32 ]; then
    echo 'Each database password must be at least 32 characters.' >&2
    exit 1
  fi
  case "$1" in
    *[!a-zA-Z0-9]*) echo 'Use alphanumeric database passwords so connection URLs remain unambiguous.' >&2; exit 1 ;;
  esac
}

create_database() {
  role="$1"
  database="$2"
  password="$3"
  validate_password "$password"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=role_name="$role" --set=database_name="$database" --set=role_password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'role_name') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'role_name') \gexec
SQL
}

create_database sc_identity schoolconnect_identity "$SC_IDENTITY_DB_PASSWORD"
create_database sc_school schoolconnect_school "$SC_SCHOOL_DB_PASSWORD"
create_database sc_content schoolconnect_content "$SC_CONTENT_DB_PASSWORD"
create_database sc_attendance schoolconnect_attendance "$SC_ATTENDANCE_DB_PASSWORD"
create_database sc_files schoolconnect_files "$SC_FILES_DB_PASSWORD"
create_database sc_notifications schoolconnect_notifications "$SC_NOTIFICATIONS_DB_PASSWORD"
create_database sc_audit schoolconnect_audit "$SC_AUDIT_DB_PASSWORD"
create_database sc_read schoolconnect_read "$SC_READ_DB_PASSWORD"

for migration in \
  010-identity.sql 020-school.sql 030-content.sql 040-attendance.sql \
  050-files.sql 060-notifications.sql 070-audit.sql 080-admin-provisioning.sql \
  095-security-and-scale.sql 096-product-workflows.sql 097-publishing-permissions.sql \
  098-observability.sql 099-notification-lifecycle.sql 100-read-model.sql 101-read-model-backfill.sql
do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --file="/opt/schoolconnect/migrations/$migration"
done

grant_runtime_access() {
  role="$1"
  database="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" \
    --set=role_name="$role" <<'SQL'
GRANT USAGE ON SCHEMA public TO :"role_name";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"role_name";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"role_name";
ALTER DEFAULT PRIVILEGES FOR ROLE sc_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"role_name";
ALTER DEFAULT PRIVILEGES FOR ROLE sc_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"role_name";
SQL
}

grant_runtime_access sc_identity schoolconnect_identity
grant_runtime_access sc_school schoolconnect_school
grant_runtime_access sc_content schoolconnect_content
grant_runtime_access sc_attendance schoolconnect_attendance
grant_runtime_access sc_files schoolconnect_files
grant_runtime_access sc_notifications schoolconnect_notifications
grant_runtime_access sc_audit schoolconnect_audit
grant_runtime_access sc_read schoolconnect_read

case "${SC_DEMO_SEED:-false}" in
  true)
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
      --file=/opt/schoolconnect/migrations/090-development-seed.sql
    ;;
  false) ;;
  *) echo 'SC_DEMO_SEED must be true or false.' >&2; exit 1 ;;
esac
