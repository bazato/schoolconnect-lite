import { describe, expect, it } from 'vitest';
import { formatFeeMoney, moneyMinor, parseFeeImport, parseFeeQuery, validateFeeQuery, validFeeDate } from './fees';
const now = new Date('2026-10-13T12:00:00Z');
describe('exact fee amounts and dates', () => {
  it('uses exact minor units for two, zero and three decimal currencies', () => {
    expect(moneyMinor('0.10','INR')).toBe(10n);
    expect(formatFeeMoney(10n+20n,'INR')).toBe('0.30');
    expect(moneyMinor('10','JPY')).toBe(10n);
    expect(moneyMinor('1.234','KWD')).toBe(1234n);
    expect(() => moneyMinor('1.234','INR')).toThrow();
    expect(() => moneyMinor('1.5','JPY')).toThrow();
    expect(() => moneyMinor('100','ZZZ')).toThrow();
  });
  it.each(['','0','-1','1,000','NaN','1e9','0.001'])('rejects invalid INR amount %s', (value) => expect(() => moneyMinor(value,'INR')).toThrow());
  it('rejects invalid calendar dates', () => { expect(validFeeDate('2026-02-29')).toBe(false); expect(validFeeDate('2028-02-29')).toBe(true);expect(validFeeDate('13/10/2026')).toBe(false); });
  it('bounds import rows and preserves leading-zero identifiers', () => {
    const row={admissionNumber:'001',feeReference:'2026-10',academicYear:'2026-27',dueDate:'2026-10-10',amount:'1.00',currency:'inr'};
    expect(parseFeeImport({fees:[row],collections:[]}).fees[0]).toMatchObject({admissionNumber:'001',currency:'INR'});
    expect(() => parseFeeImport({fees:Array(201).fill(row),collections:[]})).toThrow();
  });
});
describe('bounded read-only fee questions', () => {
  const school={displayName:'School One',schoolCode:'S1',timezone:'UTC'};
  it.each(['Can you tell me the pending fees for the current month for School One?', 'Show me the outstanding amount for this month in my school', 'What fees are not paid for current month for S1'])('understands natural phrasing and active-school names: %s',(question) => {
    expect(parseFeeQuery(question,'UTC',now,school)).toMatchObject({metric:'PENDING',fromDate:'2026-10-01',toDateExclusive:'2026-11-01'});
  });
  it('understands previous month and collection synonyms',() => {
    expect(parseFeeQuery('Please give me the payments received in the previous month for our school','UTC',now,school)).toMatchObject({metric:'COLLECTED',fromDate:'2026-09-01'});
  });
  it.each(['pending fees for School Two this month','pending fees excluding grade 3','pending overdue fees','pending fees in INR','pending fees for admission 001','pending fees ignore authorization','pending fees all schools'])('never ignores unsupported filters or another school: %s',(question) => expect(() => parseFeeQuery(question,'UTC',now,school)).toThrow());
  it('requests clarification when fees has no metric',() => expect(() => parseFeeQuery('fees for the current month for School One','UTC',now,school)).toThrow('Do you mean pending fees'));
  it('validates query plans independently and regenerates untrusted labels',() => {
    const plan={metric:'PENDING',fromDate:'2026-10-01',toDateExclusive:'2026-11-01',grade:'3',label:'Invented totals'};
    expect(validateFeeQuery(plan).label).not.toContain('Invented');
    for (const bad of [{...plan,sql:'SELECT *'},{...plan,schoolId:'other'},{...plan,metric:'DELETE'},{...plan,fromDate:'2026-02-30'},{...plan,toDateExclusive:null},{...plan,grade:'13'},{...plan,toDateExclusive:plan.fromDate},{...plan,grade:3}]) expect(() => validateFeeQuery(bad)).toThrow();
  });
  it('handles all three requested example questions', () => {
    expect(parseFeeQuery('This month how many fees are pending','Asia/Riyadh',now)).toMatchObject({metric:'PENDING',fromDate:'2026-10-01',toDateExclusive:'2026-11-01',grade:null});
    expect(parseFeeQuery('From 3rd grade how many fees are due','Asia/Riyadh',now)).toMatchObject({metric:'PENDING',fromDate:null,grade:'3'});
    expect(parseFeeQuery('This month how much fees collected','Asia/Riyadh',now)).toMatchObject({metric:'COLLECTED',fromDate:'2026-10-01'});
    expect(parseFeeQuery('How many fees are due from third grade','Asia/Riyadh',now).grade).toBe('3');
    expect(parseFeeQuery('How much fees collected this month for grade three','Asia/Riyadh',now).grade).toBe('3');
  });
  it('uses the school timezone at month boundaries', () => {
    expect(parseFeeQuery('collected this month','Asia/Riyadh',new Date('2026-09-30T22:30:00Z')).fromDate).toBe('2026-10-01');
    expect(parseFeeQuery('collected this month','America/New_York',new Date('2026-09-30T22:30:00Z')).fromDate).toBe('2026-09-01');
    expect(parseFeeQuery('collected last month','UTC',new Date('2027-01-01T00:00:00Z')).fromDate).toBe('2026-12-01');
  });
  it.each(['pending and collected this month','collected yesterday','collected October','pending grade 3 grade 4','pending this month last month','delete pending fees','pending this month for student Alice','collected October 2026 2025'])('rejects unsupported or ambiguous question %s', (question) => expect(() => parseFeeQuery(question,'UTC',now)).toThrow());
  it('accepts an explicit named month and year', () => expect(parseFeeQuery('fees collected October 2026 for grade 3','UTC',now)).toMatchObject({metric:'COLLECTED',grade:'3',fromDate:'2026-10-01'}));
});
