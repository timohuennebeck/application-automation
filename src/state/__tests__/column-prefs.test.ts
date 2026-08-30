import { describe, expect, it } from 'vitest';
import { COLUMNS, STAGE_IDS } from '../../data/config';
import { mergeColumnOpen } from '../column-prefs';

const defaults = COLUMNS.map((c) => c.open);

describe('mergeColumnOpen', () => {
  it('falls back to the column defaults without a saved map', () => {
    expect(mergeColumnOpen(null)).toEqual(defaults);
    expect(mergeColumnOpen('not json')).toEqual(defaults);
    expect(mergeColumnOpen('42')).toEqual(defaults);
  });

  it('applies saved values by stage id and keeps defaults for unknown stages', () => {
    const raw = JSON.stringify({ [STAGE_IDS[0]]: false, [STAGE_IDS[3]]: true, stray: false });
    const merged = mergeColumnOpen(raw);
    expect(merged[0]).toBe(false);
    expect(merged[3]).toBe(true);
    STAGE_IDS.forEach((_, i) => {
      if (i !== 0 && i !== 3) expect(merged[i]).toBe(defaults[i]);
    });
  });

  it('ignores non-boolean values', () => {
    const raw = JSON.stringify({ [STAGE_IDS[1]]: 'nein' });
    expect(mergeColumnOpen(raw)[1]).toBe(defaults[1]);
  });
});
