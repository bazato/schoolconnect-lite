import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=process.env.TEST_API_URL ?? 'http://127.0.0.1:3010/api/v1';
const call=async(path,token,body,expected=body ? 201 : 200) => {
  const response=await fetch(`${base}${path}`,{method:body ? 'POST':'GET',headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const result=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(result)}`);return result;
};
const login=async(phoneE164,invitationCode) => {
  let challenge;try {challenge=await call('/auth/otp/request',null,{phoneE164,invitationCode});} catch(error) {if(!String(error).includes('INVITATION_OR_PHONE_INVALID')) throw error;challenge=await call('/auth/otp/request',null,{phoneE164});}
  return call('/auth/otp/verify',null,{challengeId:challenge.challengeId,code:'123456',deviceId:`fees-${randomUUID()}`});
};
const suffix=String(Date.now()).slice(-8);
const owner=await login('+919876543200','OWNER-INVITE');
const school=await call('/admin/schools',owner.accessToken,{schoolCode:`FT${suffix}`,displayName:`Synthetic Fee Regression ${suffix}`,timezone:'Asia/Riyadh',adminDisplayName:'Fee Test Admin',adminPhoneE164:`+96658${suffix}`});
const admin=await login(`+96658${suffix}`,school.administrator.invitationCode);
const classes=[];for(const grade of ['3','4']) classes.push(await call('/admin/classes',admin.accessToken,{classCode:`G${grade}A`,displayName:`Grade ${grade}A`,academicYear:'2026-2027',gradeCode:`G${grade}`}));
let parent;for(const [index,c] of classes.entries()) {
  const child=await call('/admin/parents',admin.accessToken,{displayName:'Synthetic Fee Parent',phoneE164:`+96657${suffix}`,studentDisplayName:`Synthetic Fee Child ${index}`,admissionNumber:`F-${index}`,classId:c.id});
  if(!index) parent=await login(`+96657${suffix}`,child.parent.invitationCode);
}
const teacherAccount=await call('/admin/teachers',admin.accessToken,{displayName:'Synthetic Fee Teacher',phoneE164:`+96656${suffix}`,classId:classes[0].id,subjectCode:'MATH',subjectName:'Math'});
const teacher=await login(`+96656${suffix}`,teacherAccount.teacher.invitationCode);
const current=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit'}).formatToParts(new Date());
const month=`${current.find((part) => part.type==='year').value}-${current.find((part) => part.type==='month').value}`;
const data={fees:[0,1].map((index) => ({admissionNumber:`F-${index}`,feeReference:'TUITION',academicYear:'2026-2027',dueDate:`${month}-01`,amount:'100.00',currency:'INR',description:'Synthetic tuition'})),collections:[{admissionNumber:'F-0',feeReference:'TUITION',collectionReference:'SYNTHETIC-R1',collectionDate:`${month}-05`,amount:'40.00'}]};
for(const account of [owner,parent,teacher]) for(const path of ['search','import-preview']) await call(`/admin/fees/${path}`,account.accessToken,path==='search' ? {question:'pending this month'} : data,403);
const invalid=await call('/admin/fees/import-preview',admin.accessToken,{fees:[{...data.fees[0],admissionNumber:'INVALID'}],collections:[]});assert.equal(invalid.valid,false);assert.match(invalid.issues[0].message,/Admission/);
const preview=await call('/admin/fees/import-preview',admin.accessToken,data);assert.equal(preview.valid,true);assert.equal(preview.counts.feesAdded,2);
const batch={...data,batchId:randomUUID(),revision:preview.revision};const first=await call('/admin/fees/import-commit',admin.accessToken,batch);assert.deepEqual(await call('/admin/fees/import-commit',admin.accessToken,batch),first);
const again=await call('/admin/fees/import-preview',admin.accessToken,data);assert.equal(again.counts.feesUnchanged,2);assert.equal(again.counts.collectionsUnchanged,1);
const pending=await call('/admin/fees/search',admin.accessToken,{question:'This month how many fees are pending'});assert.equal(pending.studentCount,2);assert.equal(pending.currencies[0].amount,'160.00');
const grade=await call('/admin/fees/search',admin.accessToken,{question:'From 3rd grade how many fees are due'});assert.equal(grade.studentCount,1);assert.equal(grade.currencies[0].amount,'60.00');
const collected=await call('/admin/fees/search',admin.accessToken,{question:'This month how much fees collected'});assert.equal(collected.recordCount,1);assert.equal(collected.currencies[0].amount,'40.00');
const updated={fees:[],collections:[{...data.collections[0],amount:'50.00'}]},updatePreview=await call('/admin/fees/import-preview',admin.accessToken,updated);assert.equal(updatePreview.counts.collectionsUpdated,1);
await call('/admin/fees/import-commit',admin.accessToken,{...updated,batchId:randomUUID(),revision:updatePreview.revision});
await call('/admin/fees/import-commit',admin.accessToken,{...data,batchId:randomUUID(),revision:preview.revision},409);
assert.equal((await call('/admin/fees/search',admin.accessToken,{question:'collected this month'})).currencies[0].amount,'50.00');
await call('/admin/fees/search',admin.accessToken,{question:'delete fees for all students'},400);
// Count + authoritative report totals stay consistent under concurrent read load.
const start=Date.now();const reads=await Promise.all(Array.from({length:100},() => call('/admin/fees/search',admin.accessToken,{question:'pending this month'})));
assert.ok(reads.every((report) => report.studentCount===2 && report.currencies[0].amount==='150.00'));
console.log(`Fee API regression passed: import/update/retry, grades, reports, wrong-role denial, stale revision and 100 concurrent reads (${Date.now()-start} ms). Synthetic school retained: ${school.school.schoolCode}.`);
