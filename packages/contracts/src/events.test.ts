import { describe, expect, it } from 'vitest';
import { domainEventTypes } from './index';

describe('domain event catalog', () => {
  it('has unique versioned owner-prefixed names', () => {
    const names = Object.values(domainEventTypes);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^(content|attendance|files|identity|notifications|school)\.[a-z-]+\.v\d+$/.test(name))).toBe(true);
  });
});
