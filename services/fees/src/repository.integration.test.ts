import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeesRepository, type ImportContext } from './repository';
import type { FeeQuery } from '@schoolconnect/contracts';
const enabled=process.env.FEES_INTEGRATION==='true';
describe.skipIf(!enabled)('fee ledger against Docker PostgreSQL', () => {
  const schoolId=randomUUID(),otherSchool=randomUUID(),actorUserId=randomUUID(),actorMembershipId=randomUUID(),studentId=randomUUID();
  let repository:FeesRepository,pool:Pool;
  const data={fees:[{admissionNumber:'001',feeReference:'OCT',academicYear:'2026-27',dueDate:'2026-10-01',amount:'100.00',currency:'INR',description:'Tuition'}],collections:[{admissionNumber:'001',feeReference:'OCT',collectionReference:'R-1',collectionDate:'2026-10-05',amount:'40.00'}]};
  const context:ImportContext={schoolId,actorUserId,actorMembershipId,correlationId:randomUUID(),students:[{id:studentId,admissionNumber:'001',displayName:'Synthetic fee test child',status:'ACTIVE'}],data};
  const query:FeeQuery={metric:'PENDING',fromDate:'2026-10-01',toDateExclusive:'2026-11-01',grade:null,label:'Test month'};
  beforeAll(() => { process.env.FEES_DATABASE_URL ??= 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_fees';repository=new FeesRepository();pool=new Pool({connectionString:process.env.FEES_DATABASE_URL}); });
  afterAll(async() => {
    // Remove only these randomly generated test tenants, never user records.
    for(const table of ['fee_import_batches','fee_collections','fee_invoices','fee_ledger_state']) await pool.query(`DELETE FROM ${table} WHERE school_id=ANY($1::uuid[])`,[[schoolId,otherSchool]]);
    await pool.query("DELETE FROM outbox_events WHERE payload->>'schoolId'=ANY($1::text[])",[[schoolId,otherSchool]]);await pool.end();await repository.onModuleDestroy();
  });
  it('commits dues, collections, local audit and an outbox event in one transaction', async() => {
    const preview=await repository.preview(context);expect(preview.valid).toBe(true);
    const result=await repository.commit({...context,batchId:randomUUID(),revision:preview.revision});expect(result).toMatchObject({feesAdded:1,collectionsAdded:1,revision:1});
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM fee_import_batches WHERE school_id=$1',[schoolId])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM outbox_events WHERE payload->>'schoolId'=$1",[schoolId])).rows[0].count).toBe(1);
  });
  it('reports balances separately from dated cash collections and filters grades by scoped student IDs', async() => {
    expect(await repository.report(schoolId,query,null)).toMatchObject({studentCount:1,recordCount:1,currencies:[{currency:'INR',amount:'60.00'}]});
    expect(await repository.report(schoolId,{...query,metric:'COLLECTED'},null)).toMatchObject({currencies:[{amount:'40.00'}]});
    expect((await repository.report(schoolId,{...query,fromDate:'2026-09-01',toDateExclusive:'2026-10-01',metric:'COLLECTED'},null)).recordCount).toBe(0);
    expect((await repository.report(schoolId,{...query,grade:'3'},[])).recordCount).toBe(0);
    expect((await repository.report(schoolId,{...query,grade:'3'},[studentId])).recordCount).toBe(1);
    expect((await repository.report(otherSchool,query,null)).recordCount).toBe(0);
  });
  it('updates existing receipts rather than increasing the number of collections', async() => {
    const updated={...context,data:{fees:[],collections:[{...data.collections[0],amount:'45.00'}]}};
    const preview=await repository.preview(updated);expect(preview.counts.collectionsUpdated).toBe(1);
    await repository.commit({...updated,batchId:randomUUID(),revision:preview.revision});
    expect(await repository.report(schoolId,{...query,metric:'COLLECTED'},null)).toMatchObject({recordCount:1,currencies:[{amount:'45.00'}]});
  });
  it('handles concurrent retries idempotently and rejects reuse with different data', async() => {
    const preview=await repository.preview(context),batchId=randomUUID(),input={...context,batchId,revision:preview.revision};
    const results=await Promise.all(Array.from({length:8},() => repository.commit(input)));for (const result of results) expect(result).toEqual(results[0]);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM fee_import_batches WHERE school_id=$1 AND batch_id=$2',[schoolId,batchId])).rows[0].count).toBe(1);
    await expect(repository.commit({...input,data:{...data,fees:[{...data.fees[0],amount:'101.00'}]}})).rejects.toThrow('Conflict');
  });
  it('prevents two administrators from overwriting a stale preview', async() => {
    const preview=await repository.preview(context);
    const settled=await Promise.allSettled([101,102].map((amount) => repository.commit({...context,data:{...data,fees:[{...data.fees[0],amount:String(amount)}]},batchId:randomUUID(),revision:preview.revision})));
    expect(settled.filter((result) => result.status==='fulfilled')).toHaveLength(1);expect(settled.filter((result) => result.status==='rejected')).toHaveLength(1);
  });
  it('rejects an invalid batch without writing the other valid rows', async() => {
    const before=(await repository.preview(context)).revision;
    await expect(repository.commit({...context,data:{fees:[{...data.fees[0],feeReference:'GOOD'}, {...data.fees[0],admissionNumber:'NO-SUCH-STUDENT'}],collections:[]},batchId:randomUUID(),revision:before})).rejects.toThrow();
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM fee_invoices WHERE school_id=$1 AND fee_reference='GOOD'",[schoolId])).rows[0].count).toBe(0);
    expect((await repository.preview(context)).revision).toBe(before);
  });
  it('serves 100 concurrent consistent read requests without lost data', async() => {
    const reports=await Promise.all(Array.from({length:100},() => repository.report(schoolId,query,null)));
    expect(reports.every((report) => report.studentCount===1 && report.recordCount===1)).toBe(true);
  },15000);
});
