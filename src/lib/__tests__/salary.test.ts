import { describe, expect, it } from 'vitest';
import { SALARY_STEPS, formatSalaryRange, parseSalary, parseSalaryRange } from '../salary.ts';

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
  it('runs 50k to 100k in steps of one thousand', () => {
    expect(SALARY_STEPS[0]).toBe(50);
    expect(SALARY_STEPS.at(-1)).toBe(100);
    expect(SALARY_STEPS).toHaveLength(51);
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
