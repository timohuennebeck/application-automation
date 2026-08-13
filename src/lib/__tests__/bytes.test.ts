import { describe, expect, it } from 'vitest';
import { formatBytes } from '../bytes.ts';

describe('formatBytes', () => {
  it('names the unit a file size is usually quoted in', () => {
    expect(formatBytes(2_100_000)).toBe('2,1 MB');
    expect(formatBytes(348_000)).toBe('348 KB');
    expect(formatBytes(900)).toBe('900 B');
  });

  it('drops the decimal once it stops carrying information', () => {
    expect(formatBytes(12_400_000)).toBe('12,4 MB');
    expect(formatBytes(124_000_000)).toBe('124 MB');
    expect(formatBytes(2_000_000)).toBe('2 MB');
  });

  it('rounds up to the next unit rather than printing four digits', () => {
    expect(formatBytes(999_999)).toBe('1000 KB');
    expect(formatBytes(1_000_000)).toBe('1 MB');
  });

  it('has nothing to say about a size it was not given', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(0)).toBe('0 B');
  });
});
