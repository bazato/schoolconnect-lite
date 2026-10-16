import { createHash, randomUUID } from 'node:crypto';

// Technical identifiers are server-owned. Explicit legacy/import values remain valid.
export function generatedCode(prefix: 'SCH' | 'CLS' | 'STU') {
  return `${prefix}-${randomUUID().replaceAll('-', '').toUpperCase()}`;
}
export function subjectCodeFor(name: string) {
  return `SUB-${createHash('sha256').update(name.trim().normalize('NFKC').toUpperCase()).digest('hex').slice(0, 20).toUpperCase()}`;
}
