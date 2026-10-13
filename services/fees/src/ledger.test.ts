import { describe, expect, it } from 'vitest';
import type { FeeImport, FeeStudent } from '@schoolconnect/contracts';
import { planFeeImport, type Invoice, type Collection } from './ledger';
const students: FeeStudent[]=[{id:'s1',admissionNumber:'001',displayName:'Child One',status:'ACTIVE'}];
const fee={admissionNumber:'001',feeReference:'TERM-1',academicYear:'2026-27',dueDate:'2026-10-01',amount:'100.00',currency:'INR',description:'Tuition'};
const receipt={admissionNumber:'001',feeReference:'TERM-1',collectionReference:'R-1',collectionDate:'2026-10-05',amount:'40.00'};
const invoice: Invoice={id:'i1',studentId:'s1',admissionNumber:'001',studentName:'Child One',feeReference:'TERM-1',academicYear:'2026-27',dueDate:'2026-10-01',amountMinor:'10000',currency:'INR',description:'Tuition'};
const collection: Collection={id:'c1',invoiceId:'i1',collectionReference:'R-1',collectionDate:'2026-10-05',amountMinor:'4000'};
const plan=(input:FeeImport,invoices:Invoice[]=[],collections:Collection[]=[]) => planFeeImport(input,students,invoices,collections,0);
describe('fee import ledger plan', () => {
  it('adds new fees and receipts together', () => expect(plan({fees:[fee],collections:[receipt]}).preview).toMatchObject({valid:true,counts:{feesAdded:1,collectionsAdded:1}}));
  it('reimports identical records without duplicating them', () => expect(plan({fees:[fee],collections:[receipt]},[invoice],[collection]).preview).toMatchObject({valid:true,counts:{feesUnchanged:1,collectionsUnchanged:1}}));
  it('updates dues and receipts by stable keys', () => expect(plan({fees:[{...fee,amount:'120.00'}],collections:[{...receipt,amount:'50.00'}]},[invoice],[collection]).preview).toMatchObject({valid:true,counts:{feesUpdated:1,collectionsUpdated:1}}));
  it('supports a receipt-only upload', () => expect(plan({fees:[],collections:[receipt]},[invoice]).preview.valid).toBe(true));
  it('rejects unknown admissions, invalid dates, and duplicate invoices', () => {
    expect(plan({fees:[{...fee,admissionNumber:'other'}],collections:[]}).preview.valid).toBe(false);
    expect(plan({fees:[{...fee,dueDate:'2026-02-30'}],collections:[]}).preview.valid).toBe(false);
    expect(plan({fees:[fee,fee],collections:[]}).preview.issues[0]).toMatchObject({sheet:'Fees',row:3});
  });
  it('rejects duplicate receipts and receipts assigned to another student', () => {
    expect(plan({fees:[fee],collections:[receipt,receipt]}).preview.valid).toBe(false);
    expect(plan({fees:[],collections:[receipt]},[invoice],[{...collection,invoiceId:'someone-else'}]).preview.valid).toBe(false);
  });
  it('rejects overpayment and reducing a due below recorded collections', () => {
    expect(plan({fees:[fee],collections:[{...receipt,amount:'101.00'}]}).preview.valid).toBe(false);
    expect(plan({fees:[{...fee,amount:'30.00'}],collections:[]},[invoice],[collection]).preview.valid).toBe(false);
  });
  it('rejects changing currency with recorded collections', () => expect(plan({fees:[{...fee,currency:'SAR'}],collections:[]},[invoice],[collection]).preview.valid).toBe(false));
  it('rejects inactive or ambiguously matching students', () => {
    expect(planFeeImport({fees:[fee],collections:[]},[{...students[0],status:'INACTIVE'}],[],[],0).preview.valid).toBe(false);
    expect(planFeeImport({fees:[fee],collections:[]},[students[0],{...students[0],id:'s2'}],[],[],0).preview.valid).toBe(false);
  });
});
