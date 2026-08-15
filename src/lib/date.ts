/* Date and time helpers. The app speaks German dates (DD.MM.YYYY) at the UI
   layer and ISO (YYYY-MM-DD) internally; these convert between the two. */

export const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
export const MON_DE3 = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const DOW_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/* Calendar grids start on Monday. */
export const CAL_DOWS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

export function toISO(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function todayISO(): string {
  return toISO(new Date());
}

/* Parses the loose date strings the sample data uses — "24.07.2026",
   "vor 12 Tagen", "heute", "gestern" — into ISO. Returns '' if unparseable. */
export function dateToISO(val: string): string {
  const v = (val || '').trim();
  let m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
  m = v.match(/^vor\s+(\d+)\s+Tag/i);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - +m[1]);
    return toISO(d);
  }
  if (/^heute$/i.test(v)) return todayISO();
  if (/^gestern$/i.test(v)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISO(d);
  }
  return '';
}

export function isoToDate(iso: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
}

export function shiftISO(iso: string, days: number): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return toISO(new Date(+m[1], +m[2] - 1, +m[3] + days));
}

/* Whole days from today to `iso`; negative means in the past. */
export function dayDiff(iso: string): number {
  return Math.round(
    (new Date(iso + 'T00:00:00').getTime() - new Date(todayISO() + 'T00:00:00').getTime()) / 86400000,
  );
}

export function relLabel(diff: number): string {
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  return diff > 0 ? 'in ' + diff + ' Tagen' : 'vor ' + -diff + ' Tagen';
}

/* "Mi, 12. Aug" — the compact form used in the round selector. */
export function shortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return DOW_DE[d.getDay()] + ', ' + d.getDate() + '. ' + MON_DE3[d.getMonth()];
}

/* Shifts a 'YYYY-MM' month key by n months. */
export function shiftYM(ym: string, months: number): string {
  return toISO(new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + months, 1)).slice(0, 7);
}

export function minsOf(t: string): number {
  return +t.slice(0, 2) * 60 + +t.slice(3);
}

export function fmtMins(m: number): string {
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

/* Half-hour slots between two hours, e.g. timeRange(8, 11.5). */
export function timeRange(fromH: number, toH: number, stepMin = 30): string[] {
  const out: string[] = [];
  for (let m = fromH * 60; m <= toH * 60; m += stepMin) out.push(fmtMins(m));
  return out;
}

/* mm:ss for the running-agent timers. */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  return m + ':' + String(sec % 60).padStart(2, '0');
}

/* mm:ss elapsed since an ISO timestamp — the board card's and the run
   panel's timers count with the same clock. */
export function elapsed(iso: string, now = Date.now()): string {
  return clock(Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)));
}

/* 'vor 9 Min' / 'vor 3 Std' — minute-level relative time for the agent
   panel's step metas, counted from an ISO timestamp. */
export function ago(iso: string, now = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return 'vor ' + mins + ' Min';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return 'vor ' + hours + ' Std';
  const days = Math.floor(hours / 24);
  return days === 1 ? 'vor 1 Tag' : 'vor ' + days + ' Tagen';
}
