/** Fee imports record school-supplied dues and receipts, not payment processing. */
export type FeeRow = { admissionNumber: string; feeReference: string; academicYear: string; dueDate: string; amount: string; currency: string; description: string; sourceRow?: number };
export type CollectionRow = { admissionNumber: string; feeReference: string; collectionReference: string; collectionDate: string; amount: string; sourceRow?: number };
export type FeeImport = { fees: FeeRow[]; collections: CollectionRow[] };
export type FeeStudent = { id: string; admissionNumber: string; displayName: string; status: string; classId?: string; className?: string };
export type FeeIssue = { sheet: 'Fees' | 'Collections'; row: number; message: string };
export type FeePreview = { valid: boolean; revision: number; issues: FeeIssue[]; counts: { feesAdded: number; feesUpdated: number; feesUnchanged: number; collectionsAdded: number; collectionsUpdated: number; collectionsUnchanged: number }; rows: Array<{ sheet: string; row: number; admissionNumber: string; reference: string; action: string; currency: string; amount: string; date: string; previousAmount?: string; previousDate?: string; academicYear?: string; previousAcademicYear?: string }> };
export type FeeQuery = { metric: 'PENDING' | 'COLLECTED'; fromDate: string | null; toDateExclusive: string | null; grade: string | null; label: string };
export type FeeReport = { query: FeeQuery; studentCount: number; recordCount: number; currencies: Array<{ currency: string; amountMinor: string; amount: string }>; records: Array<{ admissionNumber: string; studentName: string; feeReference: string; collectionReference?: string; date: string; currency: string; amount: string }>; truncated: boolean };

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
export function parseFeeQuery(input: unknown, timezone: string, now = new Date()): FeeQuery {
  if (typeof input !== 'string' || !input.trim() || input.length > 300) throw new Error('Enter a fee question of up to 300 characters.');
  const text = input.toLowerCase().replace(/[?,.!]/g, ' ').replace(/\s+/g, ' ').trim();
  const pending = /\b(pending|due|unpaid|outstanding)\b/.test(text);
  const collected = /\b(collected|collections|received|paid)\b/.test(text);
  if (pending === collected) throw new Error('Ask for either pending/due fees or collected fees, not both.');
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: 'numeric' }).formatToParts(now);
  let year = Number(parts.find((part) => part.type === 'year')?.value);
  let month = Number(parts.find((part) => part.type === 'month')?.value);
  let period: string;
  let fromDate: string | null = null, toDateExclusive: string | null = null;
  const explicit = months.map((name, index) => ({ match: new RegExp(`\\b${name}(?: (20\\d{2}|2100))?\\b`).exec(text), month: index + 1 })).filter((item) => item.match);
  const periods = Number(text.includes('this month')) + Number(text.includes('last month')) + Number(/\ball time\b/.test(text)) + explicit.length;
  if (periods > 1) throw new Error('Use just one reporting period.');
  if (/\ball time\b/.test(text) || !periods && pending) period = 'All dates';
  else {
    if (!periods) throw new Error('For collections, specify this month, last month, a named month and year, or all time.');
    if (text.includes('last month')) { month--; if (!month) { month = 12; year--; } }
    if (explicit.length) { month = explicit[0].month; if (!explicit[0].match?.[1]) throw new Error('Include a year with a named month, for example October 2026.'); year = Number(explicit[0].match[1]); }
    fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    toDateExclusive = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
    period = `${months[month - 1]} ${year}`;
  }
  let remainder = text.replace(/\bthis month\b|\blast month\b|\ball time\b/g, ' ');
  for (const name of months) remainder = remainder.replace(new RegExp(`\\b${name} (20\\d{2}|2100)\\b`, 'g'), ' ');
  const gradePattern = /\b(?:grade|class) (\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)? grade\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) grade\b|\b(?:grade|class) (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g;
  const grades = [...remainder.matchAll(gradePattern)];
  if (grades.length > 1) throw new Error('Ask about one grade at a time.');
  const grade = grades.length ? String(grades[0][1] ?? grades[0][2] ?? (grades[0][3] ? ordinals.indexOf(grades[0][3]) + 1 : numberWords.indexOf(grades[0][4]) + 1)) : null;
  if (grade !== null && (Number(grade) < 1 || Number(grade) > 12)) throw new Error('Grade searches currently support grades 1 through 12.');
  remainder = remainder.replace(gradePattern, ' ').replace(/\b(how|many|much|fees|fee|are|is|were|was|pending|due|unpaid|outstanding|collected|collections|received|paid|from|for|in|of|the|this|school|please|show|me|students|student|total|amount|have|been)\b/g, ' ').trim();
  if (remainder) throw new Error('Try: “This month how many fees are pending”, “From 3rd grade how many fees are due”, or “This month how much fees collected”.');
  return { metric: pending ? 'PENDING' : 'COLLECTED', fromDate, toDateExclusive, grade, label: `${pending ? 'Outstanding on fees due' : 'Collections dated'} · ${period}${grade ? ` · Grade ${grade}` : ''}` };
}
