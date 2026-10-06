import { describe, expect, it } from 'vitest';
import { scheduledDelay } from './scheduled-runner';

describe('durable post timer', () => {
  it('fires overdue posts promptly without a zero-delay loop', () => {
    expect(scheduledDelay(new Date(900), 1000)).toBe(100);
  });
  it('supports distant dates without overflowing Node timers', () => {
    expect(scheduledDelay(new Date(1000 + 366 * 86_400_000), 1000)).toBe(2_147_483_647);
  });
});
