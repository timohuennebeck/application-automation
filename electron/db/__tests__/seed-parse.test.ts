import { describe, expect, it } from 'vitest';
import {
  dayMonthToISO, germanDateToISO, looksLikePhone, relativeToISO, splitCompany, splitTimeRange,
} from '../seed-parse';

/* Fixed reference instant so tests are deterministic. */
const NOW = new Date('2026-08-12T12:00:00.000Z');

describe('germanDateToISO', () => {
  it('parses DD.MM.YYYY', () => {
    expect(germanDateToISO('24.07.2026')).toBe('2026-07-24');
    expect(germanDateToISO('4.8.2026')).toBe('2026-08-04');
  });
  it('rejects everything else', () => {
    expect(germanDateToISO('24.07.')).toBe('');
    expect(germanDateToISO('vor 12 Tagen')).toBe('');
    expect(germanDateToISO('')).toBe('');
  });
});

describe('dayMonthToISO', () => {
  it("parses HISTORY's yearless dates", () => {
    expect(dayMonthToISO('24.07.', 2026)).toBe('2026-07-24');
    expect(dayMonthToISO('05.08.', 2026)).toBe('2026-08-05');
  });
  it('rejects other shapes', () => {
    expect(dayMonthToISO('24.07.2026', 2026)).toBe('');
    expect(dayMonthToISO('gestern', 2026)).toBe('');
  });
});

describe('relativeToISO', () => {
  it('handles vor N Tagen/Wochen/Monaten', () => {
    expect(relativeToISO('vor 12 Tagen', NOW)).toBe('2026-07-31T12:00:00.000Z');
    expect(relativeToISO('vor 1 Tag', NOW)).toBe('2026-08-11T12:00:00.000Z');
    expect(relativeToISO('vor 2 Wochen', NOW)).toBe('2026-07-29T12:00:00.000Z');
    expect(relativeToISO('vor 1 Monat', NOW)).toBe('2026-07-13T12:00:00.000Z'); // 30-day month
    expect(relativeToISO('vor 9 Min', NOW)).toBe('2026-08-12T11:51:00.000Z');
  });
  it('handles the word forms', () => {
    expect(relativeToISO('gerade eben', NOW)).toBe(NOW.toISOString());
    expect(relativeToISO('heute', NOW)).toBe(NOW.toISOString());
    expect(relativeToISO('gestern', NOW)).toBe('2026-08-11T12:00:00.000Z');
  });
  it('returns empty for future/interview phrases', () => {
    expect(relativeToISO('in 5 Tagen fällig', NOW)).toBe('');
    expect(relativeToISO('morgen 10:00', NOW)).toBe('');
    expect(relativeToISO('Do 14:30', NOW)).toBe('');
    expect(relativeToISO('3 Tage überfällig', NOW)).toBe('');
  });
});

describe('splitTimeRange', () => {
  it('splits ranges on the en-dash', () => {
    expect(splitTimeRange('10:00 – 11:00')).toEqual(['10:00', '11:00']);
    expect(splitTimeRange('09:00 – 10:30')).toEqual(['09:00', '10:30']);
  });
  it('handles empty and single times', () => {
    expect(splitTimeRange('')).toEqual([null, null]);
    expect(splitTimeRange('10:00')).toEqual(['10:00', null]);
  });
});

describe('splitCompany', () => {
  it('splits name and city on the last comma', () => {
    expect(splitCompany('Vector Labs, Zürich')).toEqual({ name: 'Vector Labs', city: 'Zürich' });
    expect(splitCompany('Kessler & Roth, Berlin')).toEqual({ name: 'Kessler & Roth', city: 'Berlin' });
  });
  it('returns null city when there is no comma', () => {
    expect(splitCompany('Talgruppe AG')).toEqual({ name: 'Talgruppe AG', city: null });
  });
});

describe('looksLikePhone', () => {
  it('recognizes phone numbers', () => {
    expect(looksLikePhone('+49 341 55 20 118')).toBe(true);
    expect(looksLikePhone('+41 44 512 90 34')).toBe(true);
  });
  it('rejects emails and text', () => {
    expect(looksLikePhone('n.wolf@vectorlabs.ch')).toBe(false);
    expect(looksLikePhone('Recruiterin')).toBe(false);
  });
});
