// Disposable LOCAL PostgreSQL/Kafka acceptance. Never uses managed/production URLs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MIGRATIONS,parseMigrationSegments } from './render-demo-db.mjs';
const requireDependency=createRequire(new URL('../services/attendance/package.json',import.meta.url));
const {Pool}=requireDependency('pg');
const run=randomUUID().replaceAll('-','').slice(0,8),topic=`nexqon-experiences-test-${run}`;
const base=new URL(process.env.EXPERIENCES_TEST_PG_URL ?? 'postgresql://schoolconnect:schoolconnect@127.0.0.1:5432/postgres');
if(!['127.0.0.1','localhost'].includes(base.hostname) || !['postgres:','postgresql:'].includes(base.protocol)) throw Error('LOCAL_DATABASE_REQUIRED');
const kinds=['attendance','content','notifications'];const names=Object.fromEntries(kinds.map((kind)=>[kind,`sc_experience_${run}_${kind}`]));
const url=(kind)=>{const next=new URL(base);next.pathname=`/${names[kind]}`;return next.toString();};
const admin=new Pool({connectionString:base.toString(),connectionTimeoutMillis:5000});const databases={},created=[];
let content,notifications,producer,kafkaAdmin,stopConsumer;let checks=0;
const ok=(message)=>{checks++;console.log(`PASS ${message}`);};
try {
  for(const kind of kinds){await admin.query(`CREATE DATABASE "${names[kind]}"`);created.push(names[kind]);databases[kind]=new Pool({connectionString:url(kind),connectionTimeoutMillis:5000});}
  for(const file of MIGRATIONS){const source=await readFile(new URL(`../infra/postgres/init/${file}`,import.meta.url),'utf8');for(const segment of parseMigrationSegments(source,file)){const kind=segment.databaseName.replace('schoolconnect_','');if(databases[kind])await databases[kind].query(segment.sql);}}
  const migration=await readFile(new URL('../infra/postgres/init/107-school-experiences.sql',import.meta.url),'utf8');
  for(const segment of parseMigrationSegments(migration,'107-school-experiences.sql'))await databases[segment.databaseName.replace('schoolconnect_','')].query(segment.sql);
  ok('new migration applies and safely reapplies on existing schemas');
  Object.assign(process.env,{NODE_ENV:'test',CONTENT_SKIP_BOOTSTRAP:'true',NOTIFICATION_SKIP_BOOTSTRAP:'true',CONTENT_DATABASE_URL:url('content'),NOTIFICATION_DATABASE_URL:url('notifications'),
    KAFKA_BROKERS:'127.0.0.1:9092',KAFKA_SSL:'false',KAFKA_SASL_MECHANISM:'',KAFKA_SASL_USERNAME:'',KAFKA_SASL_PASSWORD:'',KAFKA_CA_CERT_BASE64:'',KAFKA_EVENT_TOPIC:topic,KAFKA_CREATE_TOPIC:'false'});
  const {LeaveApplications}=await import('../services/attendance/dist/leave-applications.js');
  const {ContentRepository}=await import('../services/content/dist/main.js');
  const {NotificationRepository}=await import('../services/notifications/dist/main.js');
  const {applyNotificationEvent}=await import('../services/notifications/dist/event-consumer.js');
  const leaves=new LeaveApplications(databases.attendance);content=new ContentRepository();notifications=new NotificationRepository();
  const schoolId=randomUUID(),otherSchool=randomUUID(),classId=randomUUID(),studentId=randomUUID(),siblingId=randomUUID(),guardianUserId=randomUUID(),otherGuardian=randomUUID(),teacherUserId=randomUUID(),actorMembershipId=randomUUID();
  const input={schoolId,classId,studentId,guardianUserId,startDate:'2026-10-20',endDate:'2026-10-21',reason:'Medical appointment private details',teacherUserIds:[teacherUserId,teacherUserId]};
  const [first,retry]=await Promise.all([leaves.submit(input),leaves.submit(input)]);assert.equal(first.id,retry.id);
  assert.equal((await databases.attendance.query('SELECT count(*)::int AS count FROM parent_leave_applications')).rows[0].count,1);ok('simultaneous leave retries create one application without an absence record');
  await assert.rejects(leaves.submit({...input,reason:'Different reason'}));ok('same dates cannot silently overwrite a submitted reason');
  assert.equal((await leaves.list(otherSchool,{studentId})).length,0);await assert.rejects(leaves.context(otherSchool,first.id));ok('leave repository keeps schools isolated');
  const ack=await Promise.all([leaves.acknowledge(schoolId,first.id,actorMembershipId,'Received, thank you'),leaves.acknowledge(schoolId,first.id,actorMembershipId,'Received, thank you')]);
  assert(ack.every((row)=>row.status==='ACKNOWLEDGED'));assert.equal((await leaves.list(schoolId,{studentId}))[0].acknowledgementNote,'Received, thank you');
  assert.equal((await databases.attendance.query("SELECT count(*)::int AS count FROM outbox_events WHERE event_type='attendance.leave-application-acknowledged.v1'")).rows[0].count,1);ok('concurrent teacher acknowledgements emit exactly one status event');
  assert.equal((await databases.attendance.query('SELECT count(*)::int AS count FROM attendance_events')).rows[0].count,0);ok('leave acknowledgement does not mark or change attendance');
  await databases.attendance.query("ALTER TABLE outbox_events ADD CONSTRAINT fail_submit_test CHECK(event_type<>'attendance.leave-application-submitted.v1') NOT VALID");
  await assert.rejects(leaves.submit({...input,startDate:'2026-11-20',endDate:'2026-11-21'}));
  assert.equal((await leaves.list(schoolId,{studentId})).length,1);await databases.attendance.query('ALTER TABLE outbox_events DROP CONSTRAINT fail_submit_test');ok('outbox failure rolls back a leave application');
  const timetable={schoolId,classId,actorMembershipId,expectedVersion:0,title:'Week schedule',slots:[{day:1,start:'08:00',end:'09:00',subject:'Math'}],recipients:[{studentId,guardianUserId}]};
  assert.equal(await content.academics.timetable(schoolId,classId),null);
  const concurrent=await Promise.allSettled([content.academics.publishTimetable(timetable),content.academics.publishTimetable({...timetable,title:'Different schedule'})]);
  assert.equal(concurrent.filter((result)=>result.status==='fulfilled').length,1);const current=await content.academics.timetable(schoolId,classId);assert.equal(current.version,1);ok('simultaneous timetable edits use optimistic versions, not last-write-wins');
  const before=(await databases.content.query("SELECT count(*)::int AS count FROM outbox_events WHERE event_type='content.timetable-published.v1'")).rows[0].count;
  await content.academics.publishTimetable({...timetable,title:current.title});
  assert.equal((await databases.content.query("SELECT count(*)::int AS count FROM outbox_events WHERE event_type='content.timetable-published.v1'")).rows[0].count,before);ok('identical timetable retry does not duplicate publication or notification events');
  assert.equal(await content.academics.timetable(otherSchool,classId),null);ok('published timetable remains available only in its own school/class');
  await assert.rejects(content.academics.publishTimetable({...timetable,expectedVersion:1,slots:[...timetable.slots,{day:1,start:'08:30',end:'10:00',subject:'English'}]}));ok('overlapping timetable lessons are rejected');
  const row={admissionNumber:'AUTO-01',studentId,classId,examName:'Term 1',subjectName:'Math',marksObtained:80,maxMarks:100,resultDate:'2026-10-17',recipients:[{studentId,guardianUserId}]};
  const batch={schoolId,actorUserId:teacherUserId,authorMembershipId:actorMembershipId,idempotencyKey:randomUUID(),rows:[row,{...row,studentId:siblingId,admissionNumber:'AUTO-02',marksObtained:20,recipients:[{studentId:siblingId,guardianUserId:otherGuardian}]}]};
  const [result,resultRetry]=await Promise.all([content.publishResultBatch(batch),content.publishResultBatch(batch)]);assert.deepEqual(result,resultRetry);assert.equal((await databases.content.query('SELECT count(*)::int AS count FROM result_scores')).rows[0].count,2);ok('result batch writes structured marks atomically and deduplicates concurrent retries');
  const parentCharts=await content.academics.resultCharts(schoolId,{studentId,guardianUserIds:[guardianUserId]});assert.equal(parentCharts.points[0].percentage,80);
  assert.equal((await content.academics.resultCharts(schoolId,{studentId,guardianUserIds:[otherGuardian]})).points.length,0);
  assert.equal((await content.academics.resultCharts(otherSchool,{classId})).points.length,0);ok('parent chart filtering enforces school, child and guardian recipient');
  assert.equal((await content.academics.resultCharts(schoolId,{classId})).points[0].percentage,50);ok('teacher chart shows actual class percentage mean, not student private rows');
  await content.publishResultBatch({...batch,idempotencyKey:randomUUID(),rows:[{...row,marksObtained:90}]});
  const updated=await content.academics.resultCharts(schoolId,{classId});assert.equal(updated.points[0].percentage,55);assert.equal(updated.points[0].count,2);ok('replacement numeric result counts each student once per exam and subject');
  await assert.rejects(content.publishResultBatch({...batch,idempotencyKey:randomUUID(),rows:[{...row,resultDate:'2026-02-30'}]}));
  await assert.rejects(content.publishResultBatch({...batch,idempotencyKey:randomUUID(),rows:[{...row,marksObtained:101}]}));ok('invalid dates and marks are rejected before persistence');
  const {Kafka,logLevel}=createRequire(new URL('../packages/eventing/package.json',import.meta.url))('kafkajs');
  const kafka=new Kafka({clientId:`experience-test-${run}`,brokers:['127.0.0.1:9092'],logLevel:logLevel.NOTHING});kafkaAdmin=kafka.admin();await kafkaAdmin.connect();
  await kafkaAdmin.createTopics({topics:[{topic,numPartitions:1,replicationFactor:1,configEntries:[{name:'retention.ms',value:'60000'}]}]});
  const {startEventConsumer}=await import('../packages/eventing/dist/index.js');
  stopConsumer=await startEventConsumer(`experience-test-${run}`,(event)=>applyNotificationEvent(event,(item,correlationId)=>notifications.enqueue(item,correlationId)),{failureStore:notifications.failures,retryDelayMs:10});
  producer=kafka.producer();await producer.connect();
  for(const source of ['attendance','content']) {
    const events=await databases[source].query('SELECT * FROM outbox_events ORDER BY occurred_at');
    for(const event of events.rows) {
      if(source==='attendance')assert(!JSON.stringify(event.payload).includes(input.reason));
      const envelope={source,event:{id:event.id,eventType:event.event_type,aggregateId:event.aggregate_id,payload:event.payload,occurredAt:event.occurred_at.toISOString()}};
      await producer.send({topic,messages:[{key:event.aggregate_id,value:JSON.stringify(envelope)},{key:event.aggregate_id,value:JSON.stringify(envelope)}]});
    }
  }
  const deadline=Date.now()+30000;let rows=[];
  while(Date.now()<deadline){rows=(await databases.notifications.query('SELECT * FROM notifications')).rows;if(rows.length>=6)break;await new Promise((resolve)=>setTimeout(resolve,100));}
  assert.equal(rows.filter((row)=>row.notification_type==='LEAVE_SUBMITTED').length,1);
  assert.equal(rows.filter((row)=>row.notification_type==='LEAVE_ACKNOWLEDGED').length,1);
  assert.equal(rows.filter((row)=>row.notification_type==='TIMETABLE_PUBLISHED').length,1);
  assert.equal(rows.find((row)=>row.notification_type==='LEAVE_SUBMITTED').recipient_user_id,teacherUserId);
  assert.equal(rows.find((row)=>row.notification_type==='LEAVE_ACKNOWLEDGED').recipient_user_id,guardianUserId);
  ok('actual Kafka duplicate delivery creates one teacher leave notice and one parent acknowledgement/timetable notice');
  assert(!rows.some((row)=>row.body.includes(input.reason)));ok('private leave reason does not enter Kafka or notification bodies');
  console.log(`School experience acceptance: ${checks} passed`);
} finally {
  await stopConsumer?.().catch(()=>undefined);await producer?.disconnect().catch(()=>undefined);
  if(kafkaAdmin){await kafkaAdmin.deleteTopics({topics:[topic]}).catch(()=>undefined);await kafkaAdmin.disconnect().catch(()=>undefined);}
  await content?.onModuleDestroy();await notifications?.onModuleDestroy();await Promise.all(Object.values(databases).map((pool)=>pool.end()));
  for(const name of created){if(!/^sc_experience_[a-f0-9]{8}_(attendance|content|notifications)$/.test(name))throw Error('UNSAFE_CLEANUP');await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}
  await admin.end();
}
