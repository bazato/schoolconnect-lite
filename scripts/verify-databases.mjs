import { execFileSync } from 'node:child_process';

const databases = {
  schoolconnect_identity: ['users', 'memberships', 'otp_challenges', 'auth_sessions'],
  schoolconnect_school: ['schools', 'school_classes', 'students', 'guardian_links', 'teacher_assignments'],
  schoolconnect_content: ['posts', 'post_revisions', 'post_recipients', 'post_attachments'],
  schoolconnect_attendance: ['attendance_batches', 'attendance_events', 'attendance_current', 'absence_responses'],
  schoolconnect_files: ['file_objects', 'upload_sessions', 'file_access_events'],
  schoolconnect_notifications: ['notifications', 'device_tokens', 'delivery_attempts'],
  schoolconnect_audit: ['audit_events', 'consumer_checkpoints'],
  schoolconnect_read: ['consumed_events', 'read_posts', 'read_post_recipients', 'read_attendance'],
};

for (const [database, requiredTables] of Object.entries(databases)) {
  const output = execFileSync('docker', [
    'exec', 'schoolconnect-postgres', 'psql', '-U', 'schoolconnect', '-d', database,
    '-Atc', "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  ], { encoding: 'utf8' });
  const tables = new Set(output.trim().split(/\r?\n/).filter(Boolean));
  const missing = requiredTables.filter((table) => !tables.has(table));
  if (missing.length) throw new Error(`${database} is missing: ${missing.join(', ')}`);
  console.log(`${database}: ${tables.size} tables verified`);
}
