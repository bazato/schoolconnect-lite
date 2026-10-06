\connect schoolconnect_content

-- A deterministic event ID makes rerunning this migration safe. Each service
-- publishes its own historical snapshot; the read model never reads this DB.
INSERT INTO outbox_events (id,event_type,aggregate_id,payload)
SELECT p.id,'content.post-snapshot.v1',p.id,
  jsonb_build_object(
    'schoolId',p.school_id,'postId',p.id,
    'post',jsonb_build_object(
      'id',p.id,'schoolId',p.school_id,'authorMembershipId',p.author_membership_id,
      'classId',p.class_id,'postType',p.post_type,'status',p.status,
      'publishedAt',p.published_at,'scheduledFor',p.scheduled_for,
      'revisionNumber',r.revision_number,'title',r.title,'body',r.body,
      'subjectCode',r.subject_code,'examName',r.exam_name,'dueDate',r.due_date,
      'urgent',r.urgent,'attachments',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('fileId',a.file_id,'studentId',a.student_id,'privacyClassification',a.privacy_classification) ORDER BY a.display_order)
        FROM post_attachments a WHERE a.post_revision_id=r.id
      ),'[]'::jsonb)),
    'recipients',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('studentId',pr.student_id,'guardianUserId',pr.guardian_user_id))
      FROM post_recipients pr WHERE pr.post_id=p.id
    ),'[]'::jsonb)
  )
FROM posts p JOIN post_revisions r ON r.post_id=p.id AND r.revision_number=p.current_revision_number
ON CONFLICT (id) DO NOTHING;

\connect schoolconnect_attendance

INSERT INTO outbox_events (id,event_type,aggregate_id,payload)
SELECT e.id,'attendance.snapshot.v1',e.id,
  jsonb_build_object('schoolId',e.school_id,'classId',e.class_id,'studentId',e.student_id,
    'attendanceDate',e.attendance_date,'status',e.attendance_status,
    'revisionNumber',e.revision_number,'attendanceEventId',e.id)
FROM attendance_current c JOIN attendance_events e ON e.id=c.current_event_id
ON CONFLICT (id) DO NOTHING;
