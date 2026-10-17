// Real disposable PostgreSQL; storage and malware adapters are deliberate test doubles.
// This tests transactions/recovery/authorization, NOT live R2 or a real ClamAV engine.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
const requireFiles=createRequire(new URL('../services/files/package.json',import.meta.url));
const {Pool}=requireFiles('pg');
const {FileRepository}=requireFiles('./dist/repository.js');
const {FileValidationError}=requireFiles('./dist/clamav.js');
const {PDFDocument,PDFName,PDFString}=requireFiles('pdf-lib');
const base=new URL(process.env.FILE_TEST_POSTGRES_URL??'postgresql://schoolconnect:schoolconnect@127.0.0.1:5432/postgres');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('LOCAL_DISPOSABLE_DATABASE_ONLY');
const name=`schoolconnect_filetest_${randomUUID().replaceAll('-','')}`;
if(!/^schoolconnect_filetest_[a-f0-9]{32}$/.test(name))throw Error('INVALID_DISPOSABLE_DATABASE');
const admin=new Pool({connectionString:base.toString(),connectionTimeoutMillis:3000});
let pool,repository;let tests=0;
const objects=new Map();let scan=async()=>{},deleteFailure=false,putFailure=false,healthy=true;
const storage={
  async createUploadUrl(key){return `https://test.invalid/${key}`;},
  async read(key,max){const bytes=objects.get(key);if(!bytes)throw Error('OBJECT_NOT_FOUND');if(bytes.length>max)throw Error('OBJECT_SIZE_LIMIT');return Buffer.from(bytes);},
  async putChecked(key,bytes){if(putFailure)throw Error('STORAGE_OUTAGE');const existing=objects.get(key);if(existing)assert.deepEqual(existing,bytes);objects.set(key,Buffer.from(bytes));},
  async remove(key){if(deleteFailure)throw Error('DELETE_OUTAGE');objects.delete(key);},
  async createDownloadUrl(key){return `https://test.invalid/${key}`;},
};
const scanner={async health(){if(!healthy)throw Error('SCANNER_OUTAGE');return `ClamAV 1.4.6/28000/${new Date().toUTCString()}`;},async assertClean(bytes){await scan(bytes);return this.health();}};
const school=randomUUID(),actor=randomUUID();
const pdf=Buffer.from('%PDF-1.7\ntransactional upload test\n%%EOF\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function upload(bytes=pdf,extra={}){
  const created=await repository.createUpload({schoolId:school,actorUserId:actor,ownerType:'POST',ownerId:randomUUID(),fileName:'report.pdf',mediaType:'application/pdf',byteSize:bytes.length,checksumSha256:sha(bytes),...extra});
  objects.set(`${school}/quarantine/${created.fileId}`,Buffer.from(bytes));return created;
}
const complete=upload=>repository.completeUpload(upload.uploadSessionId,actor,school);
const state=async upload=>(await pool.query('SELECT * FROM file_objects WHERE id=$1',[upload.fileId])).rows[0];
const events=async upload=>Number((await pool.query('SELECT count(*) FROM outbox_events WHERE aggregate_id=$1',[upload.fileId])).rows[0].count);
async function check(label,run){await run();tests++;console.log(`PASS ${label}`);}
try{
  await admin.query(`CREATE DATABASE "${name}"`);base.pathname=`/${name}`;
  pool=new Pool({connectionString:base.toString(),max:8,connectionTimeoutMillis:3000});
  for(const file of ['050-files.sql','108-secure-file-processing.sql','109-compressed-private-files.sql']){
    const sql=await readFile(new URL(`../infra/postgres/init/${file}`,import.meta.url),'utf8');
    await pool.query(sql.replace(/^\\connect[^\r\n]+[\r\n]+/,''));
  }
  process.env.FILE_STORAGE_PROVIDER='s3';process.env.FILE_SCANNER_PROVIDER='clamd';
  repository=new FileRepository(storage,scanner,pool);
  await check('READY and completion event commit together; repeat completion is idempotent',async()=>{
    const item=await upload();assert.equal(item.upload.requiredHeaders['if-none-match'],'*');
    assert.equal((await complete(item)).status,'READY');assert.equal((await complete(item)).status,'READY');assert.equal(await events(item),1);
    const file=await state(item);assert.equal(file.verified_checksum_sha256,sha(pdf));assert.ok(file.scanned_at);
    assert.deepEqual(objects.get(file.private_object_key),pdf);
    assert.equal((await repository.access(item.fileId,{schoolId:school,actorUserId:actor,authorized:true})).expiresInSeconds,60);
  });
  await check('rejects forged uploader and school even for an already completed session',async()=>{
    const item=await upload();await complete(item);
    await assert.rejects(repository.completeUpload(item.uploadSessionId,randomUUID(),school),/Not Found/);
    await assert.rejects(repository.completeUpload(item.uploadSessionId,actor,randomUUID()),/Not Found/);
  });
  await check('post attachment checks enforce ownership, school and READY state',async()=>{
    const item=await upload();await assert.rejects(repository.validateAttachments({schoolId:school,actorUserId:actor,fileIds:[item.fileId]}),/Forbidden/);
    await complete(item);assert.equal((await repository.validateAttachments({schoolId:school,actorUserId:actor,fileIds:[item.fileId]})).valid,true);
    await assert.rejects(repository.validateAttachments({schoolId:school,actorUserId:randomUUID(),fileIds:[item.fileId]}),/Forbidden/);
    await assert.rejects(repository.validateAttachments({schoolId:randomUUID(),actorUserId:actor,fileIds:[item.fileId]}),/Forbidden/);
  });
  await check('private download denied before scanning and without gateway authorization',async()=>{
    const item=await upload();await assert.rejects(repository.access(item.fileId,{schoolId:school,actorUserId:actor,authorized:true}),/Forbidden/);
    await complete(item);await assert.rejects(repository.access(item.fileId,{schoolId:school,actorUserId:actor,authorized:false}),/Forbidden/);
  });
  await check('checksum mismatch is permanent, emits no completion event',async()=>{
    const item=await upload(pdf,{checksumSha256:'0'.repeat(64)});await assert.rejects(complete(item),/Bad Request/);assert.equal((await state(item)).processing_status,'REJECTED');assert.equal(await events(item),0);
  });
  await check('renamed executable is rejected before the malware scanner',async()=>{
    let called=false;scan=async()=>{called=true;};const item=await upload(Buffer.from('MZ not a PDF'));await assert.rejects(complete(item),/Bad Request/);assert.equal(called,false);scan=async()=>{};
  });
  await check('infected verdict blocks READY and Kafka completion event',async()=>{
    scan=async()=>{throw new FileValidationError('MALWARE_DETECTED');};const item=await upload();await assert.rejects(complete(item),/Bad Request/);assert.equal(await events(item),0);assert.equal((await state(item)).processing_status,'REJECTED');scan=async()=>{};
  });
  await check('scanner outage can retry the same session without re-upload',async()=>{
    const item=await upload();scan=async()=>{throw Error('SCANNER_OUTAGE');};await assert.rejects(complete(item),/Service Unavailable/);
    assert.equal((await state(item)).processing_status,'QUARANTINED');assert.equal(await events(item),0);scan=async()=>{};await complete(item);assert.equal((await state(item)).processing_attempts,2);
  });
  await check('only the exact scanned bytes are promoted if source changes during scanning',async()=>{
    const item=await upload();scan=async bytes=>{assert.deepEqual(bytes,pdf);objects.set(`${school}/quarantine/${item.fileId}`,Buffer.from('MZ replacement'));};await complete(item);scan=async()=>{};assert.deepEqual(objects.get((await state(item)).private_object_key),pdf);
  });
  await check('concurrent completion has one lease and one completion event',async()=>{
    const item=await upload();let release,entered;const enteredPromise=new Promise(resolve=>{entered=resolve;});scan=()=>new Promise(resolve=>{release=resolve;entered();});
    const first=complete(item);await enteredPromise;await assert.rejects(complete(item),/Conflict/);release();await first;scan=async()=>{};assert.equal(await events(item),1);
  });
  await check('expired crashed processing lease is recoverable',async()=>{
    const item=await upload();await pool.query(`UPDATE file_objects SET processing_status='SCANNING',processing_token=$2,processing_lease_until=now()-interval '1 minute' WHERE id=$1`,[item.fileId,randomUUID()]);await pool.query(`UPDATE upload_sessions SET status='UPLOADED' WHERE id=$1`,[item.uploadSessionId]);await complete(item);assert.equal(await events(item),1);
  });
  await check('a failed private write never marks READY and is retryable',async()=>{
    const item=await upload();putFailure=true;await assert.rejects(complete(item),/Service Unavailable/);assert.equal(await events(item),0);assert.equal((await state(item)).processing_status,'QUARANTINED');putFailure=false;await complete(item);
  });
  await check('outbox failure rolls READY back; retry safely reuses immutable object',async()=>{
    const item=await upload();await pool.query(`CREATE FUNCTION reject_file_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_outbox_failure'; END $$; CREATE TRIGGER fail_file_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_file_event();`);
    try{await assert.rejects(complete(item),/Service Unavailable/);assert.equal((await state(item)).processing_status,'QUARANTINED');assert.equal(await events(item),0);}finally{await pool.query('DROP TRIGGER fail_file_event ON outbox_events; DROP FUNCTION reject_file_event();');}
    await complete(item);assert.equal(await events(item),1);
  });
  await check('oversized actual object is rejected, not indefinitely retried',async()=>{
    const item=await upload();objects.set(`${school}/quarantine/${item.fileId}`,Buffer.concat([pdf,pdf]));await assert.rejects(complete(item),/Bad Request/);assert.equal((await state(item)).processing_status,'REJECTED');
  });
  await check('scanner capability fails closed before allocating a session',async()=>{
    healthy=false;assert.equal((await repository.capabilities()).attachmentsEnabled,false);await assert.rejects(upload(),/Service Unavailable/);healthy=true;
  });
  await check('expired unused upload is cleaned; quota released only after successful deletion',async()=>{
    const item=await upload();await pool.query(`UPDATE file_objects SET created_at=now()-interval '20 minutes' WHERE id=$1`,[item.fileId]);await pool.query(`UPDATE upload_sessions SET expires_at=now()-interval '15 minutes' WHERE id=$1`,[item.uploadSessionId]);
    await assert.rejects(complete(item),/Bad Request/);deleteFailure=true;await assert.rejects(repository.cleanupExpired(),/DELETE_OUTAGE/);assert.ok(Number((await state(item)).storage_reserved_bytes)>0);
    deleteFailure=false;await repository.cleanupExpired();assert.equal((await state(item)).storage_reserved_bytes,'0');assert.equal((await state(item)).processing_status,'DELETED');
  });
  await check('cleanup retains scanned private bytes and releases only quarantine reservation',async()=>{
    const item=await upload();await complete(item);await pool.query(`UPDATE file_objects SET created_at=now()-interval '20 minutes' WHERE id=$1`,[item.fileId]);await repository.cleanupExpired();const file=await state(item);assert.equal(file.processing_status,'READY');assert.equal(Number(file.storage_reserved_bytes),pdf.length);assert.deepEqual(objects.get(file.private_object_key),pdf);assert.ok(!objects.has(file.quarantine_object_key));
  });
  await check('concurrent quota reservations cannot overbook global/school storage',async()=>{
    const used=Number((await pool.query('SELECT sum(storage_reserved_bytes) AS total FROM file_objects')).rows[0].total);process.env.FILE_STORAGE_BUDGET_BYTES=String(used+pdf.length*2);process.env.FILE_SCHOOL_BUDGET_BYTES=String(used+pdf.length*2);
    try{const results=await Promise.allSettled([upload(),upload()]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);}finally{delete process.env.FILE_STORAGE_BUDGET_BYTES;delete process.env.FILE_SCHOOL_BUDGET_BYTES;}
  });
  const report=await PDFDocument.create();report.addPage();report.catalog.set(PDFName.of('ReportNote'),PDFString.of('Original report text'));const reportData=report.context.register(report.context.stream(Buffer.from('% result content padding\n'.repeat(150_000))));report.catalog.set(PDFName.of('ReportData'),reportData);
  const largeReport=Buffer.from(await report.save({useObjectStreams:false,updateFieldAppearances:false}));
  await check('original >5 MB rejected without allocating a session',async()=>{
    const before=Number((await pool.query('SELECT count(*) FROM file_objects')).rows[0].count);
    await assert.rejects(upload(Buffer.alloc(5_000_001)),/Bad Request/);
    assert.equal(Number((await pool.query('SELECT count(*) FROM file_objects')).rows[0].count),before);
  });
  await check('compressed bytes, not original bytes, are scanned and privately stored with separate checksums',async()=>{
    const item=await upload(largeReport);let scanned;
    scan=async bytes=>{assert.ok(bytes.length<=3_400_000);assert.ok(bytes.length<largeReport.length);scanned=Buffer.from(bytes);objects.set(`${school}/quarantine/${item.fileId}`,Buffer.from('MZ replacement'));};
    const result=await complete(item);scan=async()=>{};const file=await state(item);
    assert.equal(Number(file.byte_size),largeReport.length);assert.equal(file.checksum_sha256,sha(largeReport));assert.equal(file.stored_checksum_sha256,sha(scanned));assert.equal(file.verified_checksum_sha256,sha(scanned));
    assert.equal(Number(file.stored_byte_size),scanned.length);assert.equal(result.byteSize,scanned.length);assert.equal(Number(file.storage_reserved_bytes),largeReport.length+scanned.length);
    assert.deepEqual(objects.get(file.private_object_key),scanned);assert.equal(await events(item),1);
    await repository.validateAttachments({schoolId:school,actorUserId:actor,fileIds:[item.fileId]});
    await repository.access(item.fileId,{schoolId:school,actorUserId:actor,authorized:true});
    await pool.query(`UPDATE file_objects SET created_at=now()-interval '20 minutes' WHERE id=$1`,[item.fileId]);await repository.cleanupExpired();assert.equal(Number((await state(item)).storage_reserved_bytes),scanned.length);
  });
  await check('compression is deterministic across a failed private-write retry',async()=>{
    const item=await upload(largeReport);putFailure=true;await assert.rejects(complete(item),/Service Unavailable/);putFailure=false;await complete(item);assert.equal(await events(item),1);assert.equal((await complete(item)).byteSize,Number((await state(item)).stored_byte_size));
  });
  await check('uncompressible <5 MB PDF never reaches scanner, READY or completion outbox',async()=>{
    report.catalog.set(PDFName.of('ReportNote'),PDFString.of('Already compressed report'));report.context.assign(reportData,report.context.flateStream(randomBytes(3_600_000)));
    const bytes=Buffer.from(await report.save({useObjectStreams:false,updateFieldAppearances:false}));assert.ok(bytes.length<5_000_000);const item=await upload(bytes);let called=false;scan=async()=>{called=true;};
    try{await assert.rejects(complete(item),error=>error.getResponse().code==='FILE_CANNOT_COMPRESS_TO_LIMIT');assert.equal(called,false);assert.equal((await state(item)).processing_status,'REJECTED');assert.equal(await events(item),0);}finally{scan=async()=>{};}
  });
  console.log(JSON.stringify({passed:tests,database:'disposable local PostgreSQL',storage:'test double',scanner:'test double',liveR2Tested:false,realClamAvTested:false}));
}finally{
  if(repository)await repository.onModuleDestroy();else await pool?.end();
  // Exact, generated test database only; never an application or shared database.
  if(/^schoolconnect_filetest_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
