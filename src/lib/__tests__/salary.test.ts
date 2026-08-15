import { describe, expect, it } from 'vitest';
import {
  SALARY_STEPS,
  formatSalaryRange,
  normalizeSalaryText,
  parseSalary,
  parseSalaryRange,
} from '../salary.ts';

describe('parseSalary', () => {
  it('reads the lower end of the ranges the cards actually carry', () => {
    expect(parseSalary('58–70k €')).toBe(58_000);
    expect(parseSalary('CHF 120–135k')).toBe(120_000);
    expect(parseSalary('€ 88–102k')).toBe(88_000);
    expect(parseSalary('92–105k €')).toBe(92_000);
  });

  it('scales bare numbers that can only mean thousands', () => {
    expect(parseSalary('58')).toBe(58_000);
    expect(parseSalary('58.000 €')).toBe(58_000);
    expect(parseSalary('58000')).toBe(58_000);
  });

  it('has no number to offer for empty or non-numeric text', () => {
    expect(parseSalary('')).toBeNull();
    expect(parseSalary('nicht angegeben')).toBeNull();
    expect(parseSalary('—')).toBeNull();
  });
});

describe('SALARY_STEPS', () => {
  it('runs 50k to 200k in steps of one thousand', () => {
    expect(SALARY_STEPS[0]).toBe(50);
    expect(SALARY_STEPS.at(-1)).toBe(200);
    expect(SALARY_STEPS).toHaveLength(151);
  });
});

describe('parseSalaryRange', () => {
  it('splits the two dropdown values out of a stored range', () => {
    expect(parseSalaryRange('60–63k €')).toEqual({ from: 60, to: 63 });
    expect(parseSalaryRange('58–70k €')).toEqual({ from: 58, to: 70 });
  });

  it('reads the free-text values written before the dropdowns existed', () => {
    expect(parseSalaryRange('CHF 120–135k')).toEqual({ from: 120, to: 135 });
    expect(parseSalaryRange('€ 88–102k')).toEqual({ from: 88, to: 102 });
    expect(parseSalaryRange('58.000 €')).toEqual({ from: 58, to: null });
  });

  it('keeps a one-sided range on the side it was written for', () => {
    expect(parseSalaryRange('ab 62k €')).toEqual({ from: 62, to: null });
    expect(parseSalaryRange('bis 74k €')).toEqual({ from: null, to: 74 });
  });

  it('comes back empty for a value that carries no number', () => {
    expect(parseSalaryRange('—')).toEqual({ from: null, to: null });
    expect(parseSalaryRange('')).toEqual({ from: null, to: null });
  });
});

describe('formatSalaryRange', () => {
  it('writes a range the sort can still read back', () => {
    expect(formatSalaryRange({ from: 60, to: 63 })).toBe('60–63k €');
    expect(parseSalary(formatSalaryRange({ from: 60, to: 63 }))).toBe(60_000);
  });

  it('names which end is open when only one is picked', () => {
    expect(formatSalaryRange({ from: 62, to: null })).toBe('ab 62k €');
    expect(formatSalaryRange({ from: null, to: 74 })).toBe('bis 74k €');
  });

  it('empties the field when neither end is picked', () => {
    expect(formatSalaryRange({ from: null, to: null })).toBe('');
  });

  it('survives the round trip through both dropdowns', () => {
    for (const value of ['60–63k €', 'ab 62k €', 'bis 74k €']) {
      expect(formatSalaryRange(parseSalaryRange(value))).toBe(value);
    }
  });
});

describe('parseSalaryRange with decimals', () => {
  it('rounds decimal thousands instead of splitting on the point', () => {
    expect(parseSalaryRange('87.7–128.4k €')).toEqual({ from: 88, to: 128 });
    expect(parseSalaryRange('87,5–128,4k €')).toEqual({ from: 88, to: 128 });
  });
});

describe('normalizeSalaryText', () => {
  it('turns whatever a listing states into whole thousands', () => {
    expect(normalizeSalaryText('87.700–128.400 €')).toBe('88–128k €');
    expect(normalizeSalaryText('87.7–128.4k €')).toBe('88–128k €');
    expect(normalizeSalaryText('70–85k €')).toBe('70–85k €');
    expect(normalizeSalaryText('ab 90.000 €')).toBe('ab 90k €');
    expect(normalizeSalaryText('bis 74k')).toBe('bis 74k €');
    expect(normalizeSalaryText('95.000 €')).toBe('95k €');
  });

  it('gives up on text without numbers', () => {
    expect(normalizeSalaryText('nach Vereinbarung')).toBeNull();
  });
});
