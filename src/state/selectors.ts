/* Derived views over the domain state. The board card's subtitle, interview
   chip and salary line were pre-rendered strings in the sample data; now they
   are computed from rounds, follow-ups and facts at render time. */
import { INTEREST, roundStage, SortDir, SortKey, Urgency } from '../data/config';
import { Interest, RoundState } from '../shared/enums';
import { MON_DE3, DOW_DE, dateToISO, dayDiff, todayISO } from '../lib/date';
import { parseSalary } from '../lib/salary';
import type { AppState } from './store-context';

export function factOf(st: AppState, id: string, label: string): string {
  const v = (st.factsByApp[id] || []).find((f) => f.label === label)?.value;
  return v && v !== '—' && v !== 'nicht angegeben' ? v : '';
}

export interface CardView {
  role: string;
  company: string;
  /* 'Vector Labs, Zürich' — name plus the Standort fact, like the old data. */
  companyLine: string;
  city: string;
  interest: Interest;
  channel: string;
  salary: string;
  summary: string;
  website: string;
}

export function cardView(st: AppState, id: string): CardView | null {
  const app = st.applications[id];
  if (!app) return null;
  const company = st.companies[app.company_id];
  const name = company?.name ?? '';
  const city = factOf(st, id, 'Standort');
  return {
    role: app.role,
    company: name,
    companyLine: name + (city ? ', ' + city : ''),
    city,
    interest: app.interest,
    channel: app.channel || '',
    salary: factOf(st, id, 'Gehalt'),
    /* Empty is a real state: the detail view shows its placeholder rather
       than a sentence nobody wrote. */
    summary: app.summary ?? '',
    website: company?.website || '',
  };
}

/* How many filters (not the sort) are narrowing the board — the count on the
   toolbar button. */
export function activeFilterCount(st: AppState): number {
  return st.boardFilter.interests.length;
}

export function isFiltered(st: AppState): boolean {
  return activeFilterCount(st) > 0;
}

/* A sort replaces the board's own order, so the columns can no longer be
   reordered by hand while one is on. */
export function isSorted(st: AppState): boolean {
  return st.boardFilter.sort !== SortKey.NONE;
}

function matchesFilter(st: AppState, id: string): boolean {
  const f = st.boardFilter;
  const app = st.applications[id];
  if (!app) return false;

  return !f.interests.length || f.interests.includes(app.interest);
}

/* Ranks a card on the active sort key. Cards with nothing to compare (no
   salary recorded, no company row) come back null and sink to the bottom
   whichever way the sort runs. */
function sortValue(st: AppState, id: string): number | string | null {
  const app = st.applications[id];
  if (!app) return null;
  switch (st.boardFilter.sort) {
    case SortKey.SALARY:
      return parseSalary(factOf(st, id, 'Gehalt'));
    case SortKey.INTEREST:
      return INTEREST[app.interest][1];
    case SortKey.COMPANY:
      return st.companies[app.company_id]?.name || null;
    case SortKey.ROLE:
      return app.role;
    default:
      return null;
  }
}

/* The cards of one column as the board should show them: filtered, then
   ordered by the active sort (the stored order when there is none). */
export function visibleCards(st: AppState, ci: number): string[] {
  const cards = (st.board[ci] || []).filter((id) => matchesFilter(st, id));
  if (!isSorted(st)) return cards;

  const sign = st.boardFilter.dir === SortDir.DESC ? -1 : 1;
  return cards
    .map((id) => ({ id, value: sortValue(st, id) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        return a.value === b.value ? 0 : a.value === null ? 1 : -1;
      }
      if (typeof a.value === 'string' || typeof b.value === 'string') {
        return sign * String(a.value).localeCompare(String(b.value), 'de');
      }
      return sign * (a.value - b.value);
    })
    .map((entry) => entry.id);
}

/* The soonest round that is scheduled and not done yet, with its index in the
   card's round list. Both the date chip and the subtitle key off this one. */
function nextRound(rounds: AppState['roundsState'][string]) {
  const today = todayISO();
  return rounds
    .map((r, i) => ({ r, i, iso: dateToISO(r.date) }))
    .filter(({ r, iso }) => r.state !== RoundState.DONE && iso && iso >= today)
    .sort((a, b) => (a.iso < b.iso ? -1 : 1))[0];
}

export interface InterviewChip {
  month: string;
  day: string;
  time: string;
  meta: string;
}

/* The next scheduled, not-yet-done round — the card's date chip. */
export function interviewChip(st: AppState, id: string): InterviewChip | null {
  const rounds = st.roundsState[id] || [];
  const next = nextRound(rounds);
  if (!next) return null;
  const d = new Date(next.iso + 'T00:00:00');
  return {
    month: MON_DE3[d.getMonth()].toUpperCase(),
    day: String(d.getDate()),
    time: next.r.time,
    meta: roundStage(next.i, rounds.length).name + (next.r.where ? ' · ' + next.r.where : ''),
  };
}

export interface CardSubtitle {
  text: string;
  tone: Urgency;
}

/* Precedence mirrors the sample data: next interview, else a follow-up coming
   due within a week, else last activity. */
export function cardSubtitle(st: AppState, id: string): CardSubtitle {
  const next = nextRound(st.roundsState[id] || []);
  if (next) {
    const diff = dayDiff(next.iso);
    const start = next.r.time.split(/\s*[–-]\s*/)[0] || '';
    const d = new Date(next.iso + 'T00:00:00');
    const when = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : DOW_DE[d.getDay()];
    return { text: (when + ' ' + start).trim(), tone: Urgency.MUTED };
  }

  // The next actionable follow-up: the soonest upcoming one if it is within a
  // week, else the most recently missed one — never the oldest overdue slot.
  const diffs = (st.followupsByApp[id] || []).map((f) => dayDiff(f.due_at));
  const upcoming = diffs.filter((d) => d >= 0).sort((a, b) => a - b)[0];
  const overdue = diffs.filter((d) => d < 0).sort((a, b) => b - a)[0];
  const due = upcoming !== undefined && upcoming <= 7 ? upcoming : overdue;
  if (due !== undefined) {
    if (due < 0) return { text: -due + (due === -1 ? ' Tag' : ' Tage') + ' überfällig', tone: Urgency.DUE };
    if (due === 0) return { text: 'heute fällig', tone: Urgency.DUE };
    return { text: 'in ' + due + ' Tagen fällig', tone: Urgency.SOON };
  }

  const upd = st.applications[id]?.updated_at;
  const days = upd ? -dayDiff(upd.slice(0, 10)) : 0;
  return {
    text:
      days <= 0
        ? 'gerade eben'
        : days === 1
          ? 'vor 1 Tag'
          : days < 14
            ? 'vor ' + days + ' Tagen'
            : days < 60
              ? 'vor ' + Math.round(days / 7) + ' Wochen'
              : 'vor ' + Math.round(days / 30) + ' Monaten',
    tone: Urgency.MUTED,
  };
}
