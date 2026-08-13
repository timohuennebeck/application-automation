import { describe, expect, it } from 'vitest';
import { parseSalary } from '../salary.ts';

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
