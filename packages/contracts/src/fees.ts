/** Fee imports record school-supplied dues and receipts, not payment processing. */
export type FeeRow = { admissionNumber: string; feeReference: string; academicYear: string; dueDate: string; amount: string; currency: string; description: string; sourceRow?: number };
export type CollectionRow = { admissionNumber: string; feeReference: string; collectionReference: string; collectionDate: string; amount: string; sourceRow?: number };
export type FeeImport = { fees: FeeRow[]; collections: CollectionRow[] };
export type FeeStudent = { id: string; admissionNumber: string; displayName: string; status: string; classId?: string; className?: string };
export type FeeIssue = { sheet: 'Fees' | 'Collections'; row: number; message: string };
export type FeePreview = { valid: boolean; revision: number; issues: FeeIssue[]; counts: { feesAdded: number; feesUpdated: number; feesUnchanged: number; collectionsAdded: number; collectionsUpdated: number; collectionsUnchanged: number }; rows: Array<{ sheet: string; row: number; admissionNumber: string; reference: string; action: string; currency: string; amount: string; date: string; previousAmount?: string; previousDate?: string; academicYear?: string; previousAcademicYear?: string }> };
export type FeeQuery = { metric: 'PENDING' | 'COLLECTED'; fromDate: string | null; toDateExclusive: string | null; grade: string | null; label: string };
export type FeeReport = { query: FeeQuery; studentCount: number; recordCount: number; currencies: Array<{ currency: string; amountMinor: string; amount: string }>; records: Array<{ admissionNumber: string; studentName: string; feeReference: string; collectionReference?: string; date: string; currency: string; amount: string }>; truncated: boolean };
export type FeeClarification = { kind: 'CLARIFICATION'; message: string; suggestions: string[] };
export type FeeSearchResult = (FeeReport & { schoolName?: string; interpretedBy?: 'rules' | 'ollama' | 'groq' }) | FeeClarification;
export type FeeSchoolContext = { displayName: string; schoolCode: string; timezone: string };
export class FeeQuestionError extends Error {
  constructor(message: string, readonly kind: 'CLARIFICATION' | 'UNSUPPORTED' | 'INVALID' = 'UNSUPPORTED') { super(message); }
}

/** Independent validation at both gateway and ledger boundary. No generated SQL/tenant identifiers. */
export function validateFeeQuery(input: unknown): FeeQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid fee report filters.');
  const query = input as Record<string, unknown>;
  if (Object.keys(query).some((key) => !['metric','fromDate','toDateExclusive','grade','label'].includes(key)) || !['PENDING','COLLECTED'].includes(String(query.metric))) throw new Error('Invalid fee report metric or fields.');
  if (query.fromDate !== null && !validFeeDate(query.fromDate) || query.toDateExclusive !== null && !validFeeDate(query.toDateExclusive) || (query.fromDate === null) !== (query.toDateExclusive === null)) throw new Error('Invalid fee reporting dates.');
  if (typeof query.fromDate === 'string' && typeof query.toDateExclusive === 'string' && query.fromDate >= query.toDateExclusive) throw new Error('Reporting start must precede its end.');
  if (query.grade !== null && (typeof query.grade !== 'string' || !/^(?:[1-9]|1[0-2])$/.test(query.grade))) throw new Error('Grade searches currently support grades 1 through 12.');
  const metric = query.metric as FeeQuery['metric'], fromDate = query.fromDate as string | null, toDateExclusive = query.toDateExclusive as string | null, grade = query.grade as string | null;
  return { metric, fromDate, toDateExclusive, grade, label: `${metric === 'PENDING' ? 'Outstanding on fees due' : 'Collections dated'} · ${fromDate ? `${fromDate} to ${toDateExclusive} (end exclusive)` : 'All dates'}${grade ? ` · Grade ${grade}` : ''}` };
}

const normalizeFeeText = (value: string) => value.toLowerCase().replace(/[?,.!]/g, ' ').replace(/\s+/g, ' ').trim();
export function feeSchoolMatches(name: string, school: FeeSchoolContext): boolean {
  return [school.displayName, school.schoolCode].some((alias) => normalizeFeeText(alias) === normalizeFeeText(name));
}
export function scopeFeeQuestion(input: unknown, school?: FeeSchoolContext): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 300) throw new FeeQuestionError('Enter a fee question of up to 300 characters.', 'INVALID');
  let text = normalizeFeeText(input);
  // Never reinterpret destructive instructions, policy bypasses or multi-school requests as reports.
  if (/\b(delete|drop|update|insert|alter|truncate|ignore|bypass|sql|refund|all schools|other schools|every school)\b/.test(text)) throw new FeeQuestionError('Search is read-only and limited to your active school. Ask about pending fees or recorded collections.', 'INVALID');
  if (school) for (const alias of [school.displayName, school.schoolCode].sort((a,b) => b.length-a.length)) {
    const escaped = normalizeFeeText(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) text = text.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'g'), ' ');
  }
  text = text.replace(/\b(?:my|our|this|the current|current) school\b/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function validFeeDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100;
}

export function currencyScale(currency: string): number {
  // Intl alone accepts arbitrary three-letter codes; require a real ISO currency.
  if (!Intl.supportedValuesOf('currency').includes(currency)) throw new Error('Use a supported ISO currency code, such as INR or SAR.');
  const scale = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (scale === undefined) throw new Error('Currency precision unavailable.');
  return scale;
}

export function moneyMinor(value: unknown, currency: string): bigint {
  const scale = currencyScale(currency);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,12}(?:\.\d{1,3})?$/.test(text)) throw new Error('Amount must be a positive decimal without commas or currency symbols.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > scale) throw new Error(`${currency} permits ${scale} decimal places.`);
  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  if (result <= 0n) throw new Error('Amount must be greater than zero.');
  return result;
}

export function formatFeeMoney(minor: bigint | string, currency: string): string {
  const value = BigInt(minor), scale = currencyScale(currency), factor = 10n ** BigInt(scale);
  return `${value / factor}${scale ? `.${(value % factor).toString().padStart(scale, '0')}` : ''}`;
}

export function parseFeeImport(value: unknown): FeeImport {
  if (!value || typeof value !== 'object') throw new Error('Fee workbook data is required.');
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.fees) || !Array.isArray(body.collections) || !body.fees.length && !body.collections.length || body.fees.length + body.collections.length > 200) throw new Error('Import between 1 and 200 fee/collection rows per batch.');
  const text = (row: Record<string, unknown>, key: string, max = 120) => {
    const value = row[key];
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${key} is required.`);
    const result = String(value).trim();
    if (!result || result.length > max || [...result].some((character) => character.charCodeAt(0) < 32)) throw new Error(`${key} is missing, too long, or contains control characters.`);
    return result;
  };
  const object = (row: unknown): Record<string, unknown> => { if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid workbook row.'); return row as Record<string, unknown>; };
  const sourceRow = (row: Record<string,unknown>, index:number) => { const number=row.sourceRow ?? index+2; if (typeof number!=='number' || !Number.isInteger(number) || number<2 || number>201) throw new Error('Invalid source row.');return number; };
  return {
    fees: body.fees.map((input,index) => { const row = object(input), number=sourceRow(row,index); try { if (typeof row.description==='string' && row.description.length>300) throw new Error('description must not exceed 300 characters.');return { sourceRow:number,admissionNumber: text(row, 'admissionNumber'), feeReference: text(row, 'feeReference'), academicYear: text(row, 'academicYear', 40), dueDate: text(row, 'dueDate', 10), amount: text(row, 'amount', 20), currency: text(row, 'currency', 3).toUpperCase(), description: typeof row.description === 'string' ? row.description.trim() : '' }; } catch(error) { throw new Error(`Fees row ${number}: ${error instanceof Error ? error.message : 'Invalid row.'}`); } }),
    collections: body.collections.map((input,index) => { const row = object(input),number=sourceRow(row,index); try { return { sourceRow:number,admissionNumber: text(row, 'admissionNumber'), feeReference: text(row, 'feeReference'), collectionReference: text(row, 'collectionReference'), collectionDate: text(row, 'collectionDate', 10), amount: text(row, 'amount', 20) }; } catch(error) { throw new Error(`Collections row ${number}: ${error instanceof Error ? error.message : 'Invalid row.'}`); } }),
  };
}

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const numberWords = ['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];

/** Deliberately bounded English grammar. Never turns user speech into SQL. */
export function parseFeeQuery(input: unknown, timezone: string, now = new Date(), school?: FeeSchoolContext): FeeQuery {
  const text = scopeFeeQuestion(input,school);
  const pending = /\b(pending|due|unpaid|outstanding|owed|balance|not paid)\b/.test(text);
  const collected = /\b(collected|collections|received|payments|receipts)\b/.test(text) || /\bpaid\b/.test(text.replace(/\bnot paid\b/g,''));
  if (pending === collected) throw new FeeQuestionError('Do you mean pending fees or fees collected? Please choose one.', 'CLARIFICATION');
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: 'numeric' }).formatToParts(now);
  let year = Number(parts.find((part) => part.type === 'year')?.value);
  let month = Number(parts.find((part) => part.type === 'month')?.value);
  let period: string;
  let fromDate: string | null = null, toDateExclusive: string | null = null;
  const explicit = months.map((name, index) => ({ match: new RegExp(`\\b${name}(?: (20\\d{2}|2100))?\\b`).exec(text), month: index + 1 })).filter((item) => item.match);
  const thisMonth = /\b(?:this|current|present) month\b/.test(text), lastMonth = /\b(?:last|previous) month\b/.test(text);
  const periods = Number(thisMonth) + Number(lastMonth) + Number(/\ball time\b/.test(text)) + explicit.length;
  if (periods > 1) throw new FeeQuestionError('Use just one reporting period.', 'CLARIFICATION');
  if (/\ball time\b/.test(text) || !periods && pending) period = 'All dates';
  else {
    if (!periods) throw new FeeQuestionError('For collections, specify this month, last month, a named month and year, or all time.', 'CLARIFICATION');
    if (lastMonth) { month--; if (!month) { month = 12; year--; } }
    if (explicit.length) { month = explicit[0].month; if (!explicit[0].match?.[1]) throw new FeeQuestionError('Include a year with a named month, for example October 2026.', 'CLARIFICATION'); year = Number(explicit[0].match[1]); }
    fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    toDateExclusive = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
    period = `${months[month - 1]} ${year}`;
  }
  let remainder = text.replace(/\b(?:this|current|present|last|previous) month\b|\ball time\b/g, ' ');
  for (const name of months) remainder = remainder.replace(new RegExp(`\\b${name} (20\\d{2}|2100)\\b`, 'g'), ' ');
  const gradePattern = /\b(?:grade|class) (\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)? grade\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) grade\b|\b(?:grade|class) (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g;
  const grades = [...remainder.matchAll(gradePattern)];
  if (grades.length > 1) throw new FeeQuestionError('Ask about one grade at a time.', 'CLARIFICATION');
  const grade = grades.length ? String(grades[0][1] ?? grades[0][2] ?? (grades[0][3] ? ordinals.indexOf(grades[0][3]) + 1 : numberWords.indexOf(grades[0][4]) + 1)) : null;
  if (grade !== null && (Number(grade) < 1 || Number(grade) > 12)) throw new FeeQuestionError('Grade searches currently support grades 1 through 12.', 'INVALID');
  remainder = remainder.replace(gradePattern, ' ').replace(/\b(how|many|much|fees|fee|are|is|were|was|pending|due|unpaid|outstanding|owed|balance|not paid|collected|collections|received|payments|receipts|paid|from|for|in|of|the|this|school|please|show|me|students|student|total|amount|have|been|can|could|would|you|tell|give|get|i|want|to|know|what|about|a|report|on|and)\b/g, ' ').trim();
  if (remainder) throw new FeeQuestionError('I could not safely interpret all filters. Use pending or collected fees, this/current month, last month, a month and year, and optionally grade 1–12. Named schools must match your active school.');
  return { ...validateFeeQuery({ metric: pending ? 'PENDING' : 'COLLECTED', fromDate, toDateExclusive, grade }), label: `${pending ? 'Outstanding on fees due' : 'Collections dated'} · ${period}${grade ? ` · Grade ${grade}` : ''}` };
}
