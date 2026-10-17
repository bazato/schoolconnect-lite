// Read-only PostgreSQL regression: CTE fixtures shadow tables; no data is written.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const requireSchool=createRequire(new URL('../services/school/package.json',import.meta.url));
const {teacherRosterSql}=requireSchool('./dist/teacher-roster.js');
const fixtures=`WITH
students(id,school_id,display_name,admission_number,status) AS (VALUES
 ('active','school-a','Active','001','ACTIVE'),
 ('remaining-parent','school-a','Remaining Parent','002','ACTIVE'),
 ('revoked','school-a','Revoked','003','ACTIVE'),
 ('unlinked','school-a','Unlinked','004','ACTIVE'),
 ('foreign-link','school-a','Foreign Link','005','ACTIVE'),
 ('inactive-student','school-a','Inactive Student','006','INACTIVE'),
 ('inactive-enrollment','school-a','Inactive Enrollment','007','ACTIVE'),
 ('other-class','school-a','Other Class','008','ACTIVE'),
 ('other-school','school-b','Other School','009','ACTIVE')),
enrollments(student_id,school_id,class_id,status) AS (VALUES
 ('active','school-a','class-a','ACTIVE'),
 ('remaining-parent','school-a','class-a','ACTIVE'),
 ('revoked','school-a','class-a','ACTIVE'),
 ('unlinked','school-a','class-a','ACTIVE'),
 ('foreign-link','school-a','class-a','ACTIVE'),
 ('inactive-student','school-a','class-a','ACTIVE'),
 ('inactive-enrollment','school-a','class-a','INACTIVE'),
 ('other-class','school-a','class-b','ACTIVE'),
 ('other-school','school-b','class-a','ACTIVE')),
guardian_links(school_id,student_id,guardian_user_id,status) AS (VALUES
 ('school-a','active','parent-1','ACTIVE'),
 ('school-a','active','parent-2','ACTIVE'),
 ('school-a','remaining-parent','parent-3','REVOKED'),
 ('school-a','remaining-parent','parent-4','ACTIVE'),
 ('school-a','revoked','parent-5','REVOKED'),
 ('school-b','foreign-link','parent-6','ACTIVE'),
 ('school-a','inactive-student','parent-7','ACTIVE'),
 ('school-a','inactive-enrollment','parent-8','ACTIVE'),
 ('school-a','other-class','parent-9','ACTIVE'),
 ('school-b','other-school','parent-10','ACTIVE'))`;
const scenarios=[
 {school:'school-a',classId:'class-a',expected:['active','remaining-parent']},
 {school:'school-a',classId:'class-b',expected:['other-class']},
 {school:'school-b',classId:'class-a',expected:['other-school']},
 {school:'school-c',classId:'class-a',expected:[]},
];
if(process.argv.includes('--print-sql')){
 // Constants are synthetic fixture values, never user input or credentials.
 console.log(scenarios.map((item,index)=>`(${fixtures}, actual AS (${teacherRosterSql.replaceAll('$1',`'${item.school}'`).replaceAll('$2',`'${item.classId}'`)}) SELECT ${index+1} AS scenario,COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) AS actual_ids FROM actual)`).join('\nUNION ALL\n'));
}else{
 const {Pool}=requireSchool('pg');
 const url=new URL(process.env.SCHOOL_ROSTER_TEST_DATABASE_URL??'postgresql://schoolconnect:schoolconnect@127.0.0.1:5432/postgres');
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('LOCAL_DATABASE_ONLY');
 const pool=new Pool({connectionString:url.toString(),connectionTimeoutMillis:3000});
 try{
  for(const item of scenarios){
   const {rows}=await pool.query(`${fixtures} ${teacherRosterSql}`,[item.school,item.classId]);
   assert.deepEqual(rows.map(row=>row.id).sort(),item.expected);
   console.log(`PASS teacher roster ${item.school}/${item.classId}`);
  }
 }finally{await pool.end();}
}
