/* Pure parsers for the loose German strings in sample-data.ts. Only the seed
   uses these — the app itself stores real dates from day one. All functions
   take `now` explicitly so tests stay deterministic. */

/* 'DD.MM.YYYY' → 'YYYY-MM-DD'; '' if the string is anything else. */
export function germanDateToISO(val: string): string {
  const m = (val || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/* HISTORY's yearless 'DD.MM.' with an assumed year. */
export function dayMonthToISO(val: string, year: number): string {
  const m = (val || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.$/);
  if (!m) return '';
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const UNIT_MS: [RegExp, number][] = [
  [/^vor\s+(\d+)\s+Min/i, 60_000],
  [/^vor\s+(\d+)\s+Tag/i, 86_400_000],
  [/^vor\s+(\d+)\s+Woche/i, 7 * 86_400_000],
  [/^vor\s+(\d+)\s+Monat/i, 30 * 86_400_000],
];

/* Past-relative phrases → ISO datetime; '' for anything future- or
   schedule-flavoured ('in 5 Tagen fällig', 'morgen 10:00', 'Do 14:30'). */
export function relativeToISO(val: string, now: Date): string {
  const v = (val || '').trim();
  if (/^(gerade eben|heute)$/i.test(v)) return now.toISOString();
  if (/^gestern$/i.test(v)) return new Date(now.getTime() - 86_400_000).toISOString();
  for (const [re, ms] of UNIT_MS) {
    const m = v.match(re);
    if (m) return new Date(now.getTime() - +m[1] * ms).toISOString();
  }
  return '';
}

/* "'10:00 – 11:00'" → ['10:00', '11:00']; tolerates a single time or none. */
export function splitTimeRange(val: string): [string | null, string | null] {
  const parts = (val || '')
    .split(/\s*[–-]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return [parts[0] || null, parts[1] || null];
}

/* "'Vector Labs, Zürich'" → name + city; the sample data always uses the last
   comma as the separator. */
export function splitCompany(val: string): { name: string; city: string | null } {
  const i = (val || '').lastIndexOf(', ');
  if (i < 0) return { name: val.trim(), city: null };
  return { name: val.slice(0, i).trim(), city: val.slice(i + 2).trim() || null };
}

/* BEW-29 has a phone number in the contact tuple's email slot; route by shape. */
export function looksLikePhone(val: string): boolean {
  return /^[+0-9][0-9 /()-]{5,}$/.test((val || '').trim());
}
