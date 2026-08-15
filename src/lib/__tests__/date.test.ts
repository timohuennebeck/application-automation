import { describe, expect, it } from 'vitest';
import { ago } from '../date';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const shift = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('ago', () => {
  it('calls anything under a minute "gerade eben"', () => {
    expect(ago(shift(0), NOW)).toBe('gerade eben');
    expect(ago(shift(59_000), NOW)).toBe('gerade eben');
  });

  it('counts minutes, then hours, then days', () => {
    expect(ago(shift(60_000), NOW)).toBe('vor 1 Min');
    expect(ago(shift(9 * 60_000), NOW)).toBe('vor 9 Min');
    expect(ago(shift(3 * 3_600_000), NOW)).toBe('vor 3 Std');
    expect(ago(shift(2 * 86_400_000), NOW)).toBe('vor 2 Tagen');
  });
});
