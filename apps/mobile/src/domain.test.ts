import { describe, expect, it } from 'vitest';
import { canOpenPost, posts, scopedTimeline } from './domain';

describe('mobile data scoping', () => {
  it('never mixes children in a timeline', () => {
    expect(scopedTimeline('child-jenny').every((post) => post.childId === 'child-jenny')).toBe(true);
  });

  it('denies a parent opening another child resource', () => {
    const otherChildPost = posts.find((post) => post.childId === 'child-leslie');
    expect(otherChildPost).toBeDefined();
    expect(canOpenPost('PARENT', 'child-jenny', otherChildPost!)).toBe(false);
  });
});
