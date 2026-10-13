import { formatFeeMoney, moneyMinor, validFeeDate, type FeeImport, type FeePreview, type FeeStudent } from '@schoolconnect/contracts';

export type Invoice = { id: string; studentId: string; admissionNumber: string; studentName: string; feeReference: string; academicYear: string; dueDate: string; amountMinor: string; currency: string; description: string };
export type Collection = { id: string; invoiceId: string; collectionReference: string; collectionDate: string; amountMinor: string };
export type LedgerPlan = { preview: FeePreview; invoices: Array<Invoice & { action: string }>; collections: Array<Omit<Collection, 'id' | 'invoiceId'> & { invoiceKey: string; action: string }> };
export const invoiceKey = (studentId: string, reference: string) => JSON.stringify([studentId, reference]);

export function planFeeImport(input: FeeImport, students: FeeStudent[], existingInvoices: Invoice[], existingCollections: Collection[], revision: number): LedgerPlan {
  const preview: FeePreview = { valid: false, revision, issues: [], counts: { feesAdded: 0, feesUpdated: 0, feesUnchanged: 0, collectionsAdded: 0, collectionsUpdated: 0, collectionsUnchanged: 0 }, rows: [] };
  const invoices = new Map(existingInvoices.map((invoice) => [invoiceKey(invoice.studentId, invoice.feeReference), invoice]));
  const receipts = new Map(existingCollections.map((receipt) => [receipt.collectionReference, receipt]));
  const planned: LedgerPlan = { preview, invoices: [], collections: [] };
  const issue = (sheet: 'Fees' | 'Collections', row: number, message: string) => preview.issues.push({ sheet, row, message });
  const resolve = (admission: string) => {
    const matches = students.filter((student) => student.admissionNumber.toUpperCase() === admission.toUpperCase());
    if (matches.length !== 1 || matches[0].status !== 'ACTIVE') throw new Error('Admission number must match exactly one active student in this school.');
    return matches[0];
  };
  const seenFees = new Set<string>(), seenReceipts = new Set<string>();
  input.fees.forEach((row, index) => {
    try {
      const student = resolve(row.admissionNumber), key = invoiceKey(student.id, row.feeReference), before = invoices.get(key);
      if (seenFees.has(key)) throw new Error('Duplicate student + fee reference in this workbook.');
      seenFees.add(key);
      if (!validFeeDate(row.dueDate)) throw new Error('Due date must be a real date in YYYY-MM-DD format (2000–2100).');
      const amountMinor = moneyMinor(row.amount, row.currency).toString();
      if (before && before.currency !== row.currency && existingCollections.some((receipt) => receipt.invoiceId === before.id)) throw new Error('Currency cannot change after collections have been recorded.');
      const invoice = { id: before?.id ?? '', studentId: student.id, admissionNumber: student.admissionNumber, studentName: student.displayName, feeReference: row.feeReference, academicYear: row.academicYear, dueDate: row.dueDate, amountMinor, currency: row.currency, description: row.description };
      const action = !before ? 'ADD' : Object.keys(invoice).every((name) => invoice[name as keyof Invoice] === before[name as keyof Invoice]) ? 'UNCHANGED' : 'UPDATE';
      invoices.set(key, invoice); planned.invoices.push({ ...invoice, action });
      preview.counts[action === 'ADD' ? 'feesAdded' : action === 'UPDATE' ? 'feesUpdated' : 'feesUnchanged']++;
      preview.rows.push({ sheet: 'Fees', row: row.sourceRow ?? index + 2, admissionNumber: student.admissionNumber, reference: row.feeReference, action,currency:invoice.currency,amount:formatFeeMoney(amountMinor,invoice.currency),date:row.dueDate,academicYear:row.academicYear,previousAmount:before ? `${formatFeeMoney(before.amountMinor,before.currency)} ${before.currency}` : undefined,previousDate:before?.dueDate,previousAcademicYear:before?.academicYear });
    } catch (error) { issue('Fees', row.sourceRow ?? index + 2, error instanceof Error ? error.message : 'Invalid fee row.'); }
  });
  input.collections.forEach((row, index) => {
    try {
      const student = resolve(row.admissionNumber), key = invoiceKey(student.id, row.feeReference), invoice = invoices.get(key);
      if (!invoice) throw new Error('Fee reference must exist for this student, or be included in the Fees sheet.');
      if (seenReceipts.has(row.collectionReference)) throw new Error('Duplicate collection reference in this workbook.');
      seenReceipts.add(row.collectionReference);
      if (!validFeeDate(row.collectionDate)) throw new Error('Collection date must be a real date in YYYY-MM-DD format (2000–2100).');
      const amountMinor = moneyMinor(row.amount, invoice.currency).toString(), before = receipts.get(row.collectionReference);
      if (before && before.invoiceId !== invoice.id) throw new Error('This collection reference already belongs to another fee/student; it cannot be reassigned.');
      const action = !before ? 'ADD' : before.amountMinor === amountMinor && before.collectionDate === row.collectionDate ? 'UNCHANGED' : 'UPDATE';
      planned.collections.push({ invoiceKey: key, collectionReference: row.collectionReference, collectionDate: row.collectionDate, amountMinor, action });
      preview.counts[action === 'ADD' ? 'collectionsAdded' : action === 'UPDATE' ? 'collectionsUpdated' : 'collectionsUnchanged']++;
      preview.rows.push({ sheet: 'Collections', row: row.sourceRow ?? index + 2, admissionNumber: student.admissionNumber, reference: row.collectionReference, action,currency:invoice.currency,amount:formatFeeMoney(amountMinor,invoice.currency),date:row.collectionDate,previousAmount:before ? `${formatFeeMoney(before.amountMinor,invoice.currency)} ${invoice.currency}` : undefined,previousDate:before?.collectionDate });
    } catch (error) { issue('Collections', row.sourceRow ?? index + 2, error instanceof Error ? error.message : 'Invalid collection row.'); }
  });
  for (const [key, invoice] of invoices) {
    const changes = planned.collections.filter((receipt) => receipt.invoiceKey === key);
    if (!planned.invoices.some((row) => invoiceKey(row.studentId, row.feeReference) === key) && !changes.length) continue;
    const unchanged = existingCollections.filter((receipt) => receipt.invoiceId === invoice.id && !changes.some((change) => change.collectionReference === receipt.collectionReference));
    const paid = [...unchanged, ...changes].reduce((total, receipt) => total + BigInt(receipt.amountMinor), 0n);
    if (paid > BigInt(invoice.amountMinor)) {
      const feeIndex = input.fees.findIndex((row) => row.admissionNumber.toUpperCase() === invoice.admissionNumber.toUpperCase() && row.feeReference === invoice.feeReference);
      const collectionIndex = input.collections.findIndex((row) => row.admissionNumber.toUpperCase() === invoice.admissionNumber.toUpperCase() && row.feeReference === invoice.feeReference);
      issue(feeIndex >= 0 ? 'Fees' : 'Collections', (feeIndex>=0 ? input.fees[feeIndex].sourceRow : input.collections[collectionIndex]?.sourceRow) ?? (feeIndex >= 0 ? feeIndex : collectionIndex) + 2, `Recorded collections (${formatFeeMoney(paid, invoice.currency)} ${invoice.currency}) exceed this fee. Overpayments/credits are not supported in this release.`);
    }
  }
  preview.valid = preview.issues.length === 0;
  return planned;
}
