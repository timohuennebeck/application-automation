/* The Gehalt fact is stored as text ("60–63k €", "ab 62k €") and edited through
   two dropdowns. Sorting needs a number out of that text; the lower end of the
   range is the comparable part, because it is the one every posting states.
   Values written before the dropdowns existed ("CHF 120–135k", "58.000 €") are
   still read back here, so no card loses its salary. */

/* Euros per year, or null when the text carries no number at all. A "k"
   anywhere in the value scales it, and so does a bare number below 1000 —
   nobody writes a yearly salary of 58. */
export function parseSalary(value: string): number | null {
  // Drop German thousands separators ("1.001") before reading digits.
  const match = value.replace(/\.(?=\d{3}(\D|$))/g, '').match(/\d+(?:,\d+)?/);
  if (!match) return null;

  const amount = Number(match[0].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  return /k/i.test(value) || amount < 1000 ? amount * 1000 : amount;
}

/* What the two dropdowns offer, in thousands of euros. Fine enough that a
   posting's own range ("62–74k") maps onto it exactly. */
const SALARY_MIN = 50;
const SALARY_MAX = 200;
export const SALARY_STEPS: number[] = Array.from(
  { length: SALARY_MAX - SALARY_MIN + 1 },
  (_, i) => SALARY_MIN + i,
);

/* Both ends in thousands; null is an end the user has not picked. */
export interface SalaryRange {
  from: number | null;
  to: number | null;
}

/* Splits the stored text back into the two dropdown values. Decimal
   thousands ("87.7k") are rounded — the dropdowns only speak whole k. */
export function parseSalaryRange(value: string): SalaryRange {
  // Drop German thousands separators ("58.000") before reading digits.
  const plain = value.replace(/\.(?=\d{3}(\D|$))/g, '');
  const numbers = (plain.match(/\d+(?:[.,]\d+)?/g) || [])
    .map((t) => Number(t.replace(',', '.')))
    .map((n) => (n < 1000 ? n : n / 1000))
    .map(Math.round);
  if (!numbers.length) return { from: null, to: null };
  // "bis 74k €" states an upper bound with a single number.
  if (/^\s*bis\b/i.test(plain)) return { from: null, to: numbers[0] };
  return { from: numbers[0], to: numbers[1] ?? null };
}

/* The stored text for a picked range. An open end is named rather than
   dropped, so "ab 62k €" cannot be misread as a closed range. */
export function formatSalaryRange({ from, to }: SalaryRange): string {
  if (from && to) return from + '–' + to + 'k €';
  if (from) return 'ab ' + from + 'k €';
  if (to) return 'bis ' + to + 'k €';
  return '';
}

/* Whatever a listing states ("87.700–128.400 €", "ab 90.000 €") re-said in
   the app's own format: whole thousands, the dropdowns' vocabulary. Null when
   the text carries no number ("nach Vereinbarung"). */
export function normalizeSalaryText(value: string): string | null {
  const range = parseSalaryRange(value);
  if (range.from === null && range.to === null) return null;
  /* A single stated figure is that figure — "ab" only when the text says so. */
  if (range.from !== null && range.to === null && !/\bab\b/i.test(value)) {
    return range.from + 'k €';
  }
  return formatSalaryRange(range);
}
