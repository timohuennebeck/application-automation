import { describe, expect, it } from 'vitest';
import { ago, elapsed } from '../date';

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

  it('says "vor 1 Tag", not "vor 1 Tagen", through the whole second day', () => {
    expect(ago(shift(24 * 3_600_000), NOW)).toBe('vor 1 Tag');
    expect(ago(shift(47 * 3_600_000), NOW)).toBe('vor 1 Tag');
    expect(ago(shift(48 * 3_600_000), NOW)).toBe('vor 2 Tagen');
  });
});

describe('elapsed', () => {
  it('counts mm:ss from the timestamp and clamps the future to zero', () => {
    expect(elapsed(shift(74_000), NOW.getTime())).toBe('1:14');
    expect(elapsed(shift(0), NOW.getTime())).toBe('0:00');
    expect(elapsed(shift(-5_000), NOW.getTime())).toBe('0:00');
  });
});
