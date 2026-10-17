import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teacherRosterSql } from './teacher-roster';

const database=vi.hoisted(()=>{
  process.env.SCHOOL_SKIP_BOOTSTRAP='true';
  return {query:vi.fn(),end:vi.fn()};
});
vi.mock('pg',()=>({Pool:class { query=database.query;end=database.end; }}));
import { SchoolRepository } from './main';

beforeEach(()=>database.query.mockReset().mockResolvedValue({rows:[]}));

describe('teacher roster eligibility',()=>{
  it('uses the parent-access query with the verified school and class parameters',async()=>{
    const rows=[{id:'child',displayName:'Full Student Name',admissionNumber:'001'}];
    database.query.mockResolvedValue({rows});
    expect(await new SchoolRepository().roster('school','class')).toEqual(rows);
    expect(database.query).toHaveBeenCalledWith(teacherRosterSql,['school','class']);
  });
  it('requires an active parent for this student in this school without duplicating siblings or guardians',()=>{
    expect(teacherRosterSql).toContain('EXISTS');
    expect(teacherRosterSql).toContain("g.school_id=st.school_id AND g.student_id=st.id AND g.status='ACTIVE'");
    expect(teacherRosterSql).toContain("e.school_id=$1 AND e.class_id=$2 AND e.status='ACTIVE' AND st.status='ACTIVE'");
  });
  it('keeps students without parent access visible to administrators for account repair',async()=>{
    const rows=[{id:'child',displayName:'Child',guardianCount:0}];
    database.query.mockResolvedValue({rows});
    expect(await new SchoolRepository().students('school')).toEqual(rows);
    const sql=database.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('LEFT JOIN guardian_links');
    expect(sql).not.toContain('EXISTS');
  });
});
