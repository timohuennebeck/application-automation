/* Derived views over the domain state. The board card's subtitle, interview
   chip and salary line were pre-rendered strings in the sample data; now they
   are computed from rounds, follow-ups and facts at render time. */
import { roundStage } from '../data/config';
import { MON_DE3, DOW_DE, dateToISO, dayDiff, todayISO } from '../lib/date';
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
  interest: string;
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
    summary: app.summary
      || app.role + ' bei ' + name + '. Stellenanzeige ist übernommen, Anforderungen und Unterlagen liegen strukturiert an der Karte.',
    website: company?.website || '',
  };
}

/* The soonest round that is scheduled and not done yet, with its index in the
   card's round list. Both the date chip and the subtitle key off this one. */
function nextRound(rounds: AppState['roundsState'][string]) {
  const today = todayISO();
  return rounds
    .map((r, i) => ({ r, i, iso: dateToISO(r.date) }))
    .filter(({ r, iso }) => r.state !== 'done' && iso && iso >= today)
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
  tone: 'due' | 'soon' | 'muted';
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
    return { text: (when + ' ' + start).trim(), tone: 'muted' };
  }

  // The next actionable follow-up: the soonest upcoming one if it is within a
  // week, else the most recently missed one — never the oldest overdue slot.
  const diffs = (st.followupsByApp[id] || []).map((f) => dayDiff(f.due_at));
  const upcoming = diffs.filter((d) => d >= 0).sort((a, b) => a - b)[0];
  const overdue = diffs.filter((d) => d < 0).sort((a, b) => b - a)[0];
  const due = upcoming !== undefined && upcoming <= 7 ? upcoming : overdue;
  if (due !== undefined) {
    if (due < 0) return { text: -due + (due === -1 ? ' Tag' : ' Tage') + ' überfällig', tone: 'due' };
    if (due === 0) return { text: 'heute fällig', tone: 'due' };
    return { text: 'in ' + due + ' Tagen fällig', tone: 'soon' };
  }

  const upd = st.applications[id]?.updated_at;
  const days = upd ? -dayDiff(upd.slice(0, 10)) : 0;
  return {
    text: days <= 0 ? 'gerade eben' : days === 1 ? 'vor 1 Tag'
      : days < 14 ? 'vor ' + days + ' Tagen'
        : days < 60 ? 'vor ' + Math.round(days / 7) + ' Wochen'
          : 'vor ' + Math.round(days / 30) + ' Monaten',
    tone: 'muted',
  };
}
