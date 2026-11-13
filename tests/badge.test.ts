import { describe, it, expect } from 'vitest';
import { badgeCount } from '../src/background/badge';
describe('selected account toolbar badge', () => {
  it('uses full server counts and follows the selected profile', () => {
    const counts = { personal: 142, work: 8 };
    expect(badgeCount(['personal', 'work'], '', counts)).toBe('150');
    expect(badgeCount(['personal', 'work'], 'personal', counts)).toBe('142');
    expect(badgeCount(['personal', 'work'], 'work', counts)).toBe('8');
  });
  it('clears zero counts and does not invent a count for an unavailable account', () => {
    expect(badgeCount(['a'], 'a', { a: 0 })).toBe('');
    expect(badgeCount(['a'], '', {})).toBe('?');
    expect(badgeCount(['a', 'b'], '', { a: 5, b: null })).toBe('?');
    expect(badgeCount(['a', 'b'], 'a', { a: 5, b: null })).toBe('5');
    expect(badgeCount([], '', {})).toBe('');
  });
});
