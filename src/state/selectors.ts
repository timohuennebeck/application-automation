/* Derived views over the domain state. The board card's subtitle, interview
   chip and salary line were pre-rendered strings in the sample data; now they
   are computed from rounds, follow-ups and facts at render time. */
import { INTEREST, roundColumn, SortDir, SortKey, Urgency } from '../data/config';
import {
  AgentRunStatus,
  Assignee,
  DocumentKind,
  DocumentLanguage,
  Interest,
  LinkKind,
  RoundState,
  TemplateKind,
} from '../shared/enums';
import { DOCUMENT_STEMS } from '../shared/applicant';
import type { CommentEditRow, DocumentRow } from '../shared/db-types';
import type { AgentRunView } from './db-view';
import { MON_DE3, DOW_DE, dateToISO, dayDiff, todayISO } from '../lib/date';
import { stripMarkup } from '../lib/markup';
import type { Mentionable } from '../lib/mentions';
import { parseSalary } from '../lib/salary';
import type { AppState } from './store-context';

/* One of a card's two documents — what the editor opens and what saveDocument
   writes over. Both sides read it through here so they cannot disagree about
   which row they mean. */
export function documentFor(st: AppState, id: string, kind: DocumentKind): DocumentRow | undefined {
  return (st.documentsByApp[id] || []).find((d) => d.kind === kind);
}

/* The language the card's documents are in: which side of the template slots
   a run reads and what the files are called. German until Kepler read the
   posting or the user chose — every card started German, so a card from
   before languages keeps the names its files already carry. */
export function languageOf(st: AppState, id: string): DocumentLanguage {
  return st.applications[id]?.language ?? DocumentLanguage.DE;
}

/* Which language an existing document is in, read off the file the row names
   rather than off the card: switching a card to English does not rewrite the
   documents it already has — those follow on the next Kepler run — so an edit
   has to be saved over the file it was opened from. Falls back to the card
   for a row that has no file yet, and for a name from neither side. */
export function documentLanguageOf(st: AppState, id: string, kind: DocumentKind): DocumentLanguage {
  const template = kind === DocumentKind.COVER_LETTER ? TemplateKind.ANSCHREIBEN : TemplateKind.LEBENSLAUF;
  const stored = (st.documentsByApp[id] || []).find((d) => d.kind === kind)?.file_path;
  const stem = stored?.slice(stored.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  const match = Object.values(DocumentLanguage).find((l) => DOCUMENT_STEMS[l][template] === stem);
  return match ?? languageOf(st, id);
}

/* Titles the way Kepler's own mentions spell them out — the picker, the
   comment chip and the edit status line all read off the same word, so
   nothing can drift between "@Anschreiben" and what the thread reports back.
   OTHER is never mentioned or edited, but the record stays total. */
export const DOCUMENT_TITLE: Record<DocumentKind, string> = {
  [DocumentKind.COVER_LETTER]: 'Anschreiben',
  [DocumentKind.LEBENSLAUF]: 'Lebenslauf',
  [DocumentKind.OTHER]: 'Dokument',
};

/* The card's two generated documents as mention entries — only the ones that
   actually have a file, since a mention of a document that was never
   generated would offer Kepler nothing to read. */
export function documentEntries(st: AppState, cardId: string): Mentionable[] {
  return ([DocumentKind.COVER_LETTER, DocumentKind.LEBENSLAUF] as const)
    .filter((kind) => !!documentFor(st, cardId, kind)?.file_path)
    .map((kind) => ({
      key: 'doc:' + kind,
      name: DOCUMENT_TITLE[kind],
      role: 'Dokument',
      bg: 'var(--c-f1efe9)',
      initials: '',
      kind: 'document' as const,
      document: kind,
    }));
}

/* Kepler's changes for one reply, oldest first. The repo already hands rows
   back in that order (`ORDER BY comment_id, position`), so nothing here
   re-sorts them. */
export function editsForComment(st: AppState, commentId: number): CommentEditRow[] {
  return st.commentEdits[String(commentId)] || [];
}

/* One half of a stored find/replace pair as the document SAYS it, not as
   Kepler had to quote it: the pair is kept with its markup because that is
   what applyEdits matches against the file's own bytes (documentMarkup in
   electron/agent/prompts.ts), but the thread only ever shows what changed. A
   half that is markup with no words — an image, a bare wrapping tag — has
   nothing to show; the placeholder says so rather than rendering a blank
   line that would read as a rendering bug. */
export function editText(raw: string): string {
  return stripMarkup(raw) || '(kein Text)';
}

export interface EditStatus {
  /* Whether the file still carries the set — false once every row in it has
     been undone. Never a mix: undo reverses the whole set at once. */
  applied: boolean;
  /* The document(s) the set touched, for the status line — usually one, but
     the all-or-nothing write can land across both at once. */
  title: string;
  /* Whether every document the set touched still has a PDF beside it. A
     re-print that failed leaves pdf_path null, and the line must not claim an
     export that is not there: the applicant sends the PDF, not the HTML. */
  pdf: boolean;
}

/* Null for an ordinary reply that never carried an edit set — the thread
   shows nothing beyond the text for those. */
export function editStatus(st: AppState, id: string, commentId: number): EditStatus | null {
  const rows = editsForComment(st, commentId);
  if (!rows.length) return null;
  const kinds = [...new Set(rows.map((r) => r.document))];
  return {
    applied: rows.every((r) => r.undone_at === null),
    title: kinds.map((k) => DOCUMENT_TITLE[k]).join(' und '),
    pdf: kinds.every((k) => !!documentFor(st, id, k)?.pdf_path),
  };
}

/* The card's latest Kepler run, whatever state it ended in. */
export function agentRunFor(st: AppState, id: string): AgentRunView | undefined {
  return st.agentRuns[id];
}

/* While Kepler owns the record its fields are read-only. */
export function agentLocked(st: AppState, id: string): boolean {
  const status = st.agentRuns[id]?.run.status;
  return status === AgentRunStatus.QUEUED || status === AgentRunStatus.RUNNING;
}

/* Why Kepler cannot be taken off the card right now, or null when it can.
   Only a run actually underway holds the name — a failed run is inert, so
   unassigning stays possible (the strip keeps offering the retry either way,
   and a retry puts Kepler back on the card). */
export function keplerHoldReason(st: AppState, id: string): string | null {
  if (st.applications[id]?.assignee !== Assignee.KEPLER) return null;
  if (agentLocked(st, id)) return 'Kepler arbeitet gerade – erst stoppen';
  return null;
}

/* Why handing the card to Kepler would be refused, or null when a run can
   start — the same check the main process makes, so the menu can disable the
   row instead of silently claiming work that never begins. */
export function keplerStartBlocked(st: AppState, id: string): string | null {
  const app = st.applications[id];
  if (!app || app.posting_url || app.posting_text) return null;
  return 'Keine Stellenanzeige hinterlegt – Link oder Text fehlt';
}

/* What is still referenced by a card or person — the guard the vocabulary
   popovers' trash icons and the store's delete actions share, so the icon can
   never promise a delete the store then refuses. */
export function usedCompanyIds(st: AppState): Set<number> {
  return new Set(Object.values(st.applications).map((a) => a.company_id));
}
export function usedLocations(st: AppState): Set<string> {
  return new Set(
    Object.values(st.factsByApp)
      .flat()
      .filter((f) => f.label === 'Standort')
      .map((f) => f.value.trim()),
  );
}
export function usedRoles(st: AppState): Set<string> {
  return new Set([
    ...Object.values(st.applications).map((a) => a.role.trim()),
    ...Object.values(st.people).map((p) => p.role.trim()),
  ]);
}

function factOf(st: AppState, id: string, label: string): string {
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
  homepage: string;
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
    homepage: company?.homepage || '',
  };
}

/* How many filters (not the sort) are narrowing the board — the count on the
   toolbar button. */
export function activeFilterCount(st: AppState): number {
  return st.boardFilter.interests.length;
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
    meta: roundColumn(next.r.stage, next.i, rounds.length).name + (next.r.where ? ' · ' + next.r.where : ''),
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
  // Sent ones are out of the running; nothing about them is still due.
  const diffs = (st.followupsByApp[id] || []).filter((f) => !f.completed_at).map((f) => dayDiff(f.due_at));
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

/* Everyone the pickers on a card offer, in picker order: first the people
   "known" here — linked to the card (pool, contacts, recipients), sitting on
   one of its interview rounds, or filed under the card's company — then the
   rest of the directory. Keys whose person has since been deleted are
   dropped. */
export function peopleKeysForCard(st: AppState, id: string): { key: string; known: boolean }[] {
  const companyId = st.applications[id]?.company_id;
  const links = st.linksByApp[id] || [];
  const pool = links.filter((l) => l.kind === LinkKind.POOL);
  const rest = links.filter((l) => l.kind !== LinkKind.POOL);
  const onRounds = (st.roundsState[id] || []).flatMap((r) => r.people);
  const linked = [...pool, ...rest].map((l) => String(l.person_id)).concat(onRounds);
  const atCompany = Object.keys(st.people).filter((k) => st.people[k].companyId === companyId);
  const known = [...new Set([...linked, ...atCompany])].filter((k) => st.people[k]);
  const knownSet = new Set(known);
  const others = Object.keys(st.people).filter((k) => !knownSet.has(k));
  return [...known.map((key) => ({ key, known: true })), ...others.map((key) => ({ key, known: false }))];
}
