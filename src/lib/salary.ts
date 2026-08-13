/* The Gehalt fact is free text ("58–70k €", "CHF 120–135k", "€ 88–102k"), so
   sorting by it needs a number. The lower end of the range is the comparable
   part: it is the one every posting states. */

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
