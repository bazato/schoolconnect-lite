// Teacher workflows must only offer students who have an active parent recipient.
// EXISTS keeps one roster row even when more than one guardian can receive updates.
// Administrative student management deliberately retains the complete school record.
export const teacherRosterSql = `
  SELECT st.id, st.display_name AS "displayName", st.admission_number AS "admissionNumber"
  FROM enrollments e JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
  WHERE e.school_id=$1 AND e.class_id=$2 AND e.status='ACTIVE' AND st.status='ACTIVE'
    AND EXISTS (
      SELECT 1 FROM guardian_links g
      WHERE g.school_id=st.school_id AND g.student_id=st.id AND g.status='ACTIVE'
    )
  ORDER BY st.display_name`;
