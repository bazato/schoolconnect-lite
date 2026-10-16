import {describe,it,expect} from 'vitest';
import {generatedCode,subjectCodeFor} from './codes';
describe('server-owned identifiers',()=>{
  it('generates unique bounded school, class and student codes',()=>{for(const prefix of ['SCH','CLS','STU'] as const){const codes=Array.from({length:100},()=>generatedCode(prefix));expect(new Set(codes).size).toBe(100);for(const code of codes)expect(code).toMatch(new RegExp(`^${prefix}-[A-F0-9]{32}$`));}});
  it('uses a stable predefined subject identifier without user-entered codes',()=>{expect(subjectCodeFor('Mathematics')).toBe(subjectCodeFor(' mathematics '));expect(subjectCodeFor('Mathematics')).not.toBe(subjectCodeFor('Science'));});
});
