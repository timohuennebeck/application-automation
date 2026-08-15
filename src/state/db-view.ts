/* Pure mappers between DB rows (src/shared/db-types) and the view shapes the
   components render: German dates, "10:00 – 11:00" ranges, relative times.
   The DB stores ISO; everything display-flavoured is derived here. */
import type {
  ActivityRow,
  AgentRunRow,
  AgentStepRow,
  ApplicationPersonRow,
  ApplicationRow,
  CommentAttachmentRow,
  CommentRow,
  CompanyRow,
  DbSnapshot,
  DocumentRow,
  FactRow,
  FollowupRow,
  PersonRow,
  ProfileFactRow,
  RoundInput,
  RoundNoteRow,
  RoundPersonRow,
  RoundRow,
} from '../shared/db-types';
import { STAGE_IDS } from '../data/config';
import type { Author, RoundState } from '../shared/enums';
import { dateToISO, dayDiff, isoToDate } from '../lib/date';

/* One interview round as the components render it. `dbId` ties the view back
   to its row; new rounds get one once db:rounds.set responds. */
export interface RoundView {
  dbId?: number;
  state: RoundState;
  title: string;
  /* One of the board's interview stages, '' for unstaged custom rounds. */
  stage: string;
  /* German display date DD.MM.YYYY, '' when unscheduled. */
  date: string;
  /* '10:00 – 11:00', '10:00', or ''. */
  time: string;
  where: string;
  link?: string;
  /* Person ids as strings — the keys of AppState.people. */
  people: string[];
  notes?: { author: Author; text: string; time: string }[];
  isNew?: boolean;
}

/* A person as the components consume it (AppState.people values). */
export interface PersonView {
  name: string;
  role: string;
  bg: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  initials?: string;
  companyId: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/* A Kepler run with its steps, as the panel renders it. */
export interface AgentRunView {
  run: AgentRunRow;
  steps: AgentStepRow[];
}

export interface DomainState {
  applications: Record<string, ApplicationRow>;
  companies: Record<number, CompanyRow>;
  factsByApp: Record<string, FactRow[]>;
  people: Record<string, PersonView>;
  linksByApp: Record<string, ApplicationPersonRow[]>;
  commentsByApp: Record<string, CommentRow[]>;
  /* Keyed by String(comment id). */
  attachmentsByComment: Record<string, CommentAttachmentRow[]>;
  roundsState: Record<string, RoundView[]>;
  followupsByApp: Record<string, FollowupRow[]>;
  documentsByApp: Record<string, DocumentRow[]>;
  activitiesByApp: Record<string, ActivityRow[]>;
  /* Profile-wide, so a flat list rather than one keyed by application. */
  profileFacts: ProfileFactRow[];
  /* The Standort and Berufsbezeichnung vocabularies, by name. */
  locations: string[];
  roles: string[];
  /* The latest run per application — older rows are history and stay in the
     database only. */
  agentRuns: Record<string, AgentRunView>;
  board: string[][];
}

/* 'vor 3 Tagen' / 'gerade eben' for comments, notes and activity rows. */
export function relTime(createdAt: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(createdAt).getTime()) / 60_000);
  if (mins < 60) return 'gerade eben';
  const d = dayDiff(createdAt.slice(0, 10));
  if (d === 0) return 'heute';
  if (d === -1) return 'gestern';
  return 'vor ' + -d + ' Tagen';
}

export function timeRangeText(start: string | null, end: string | null): string {
  if (!start) return '';
  return end ? start + ' – ' + end : start;
}

export function boardFrom(applications: ApplicationRow[]): string[][] {
  return STAGE_IDS.map((sid) =>
    applications
      .filter((a) => a.stage_id === sid)
      .sort((a, b) => a.stage_position - b.stage_position)
      .map((a) => a.id),
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string | number): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[String(key(r))] ??= []).push(r);
  return out;
}

export function personView(p: PersonRow): PersonView {
  const created = isoToDate(p.created_at.slice(0, 10));
  const updated = p.updated_at > p.created_at ? isoToDate(p.updated_at.slice(0, 10)) : '';
  return {
    name: p.name,
    role: p.role || '',
    bg: p.color,
    email: p.email || '',
    phone: p.phone || '',
    linkedin: p.linkedin || '',
    initials: p.initials || undefined,
    companyId: p.company_id,
    createdAt: created,
    updatedAt: updated,
  };
}

export function roundView(
  row: RoundRow,
  people: RoundPersonRow[],
  notes: RoundNoteRow[],
  now = new Date(),
): RoundView {
  return {
    dbId: row.id,
    state: row.state,
    title: row.title,
    stage: row.stage || '',
    date: row.scheduled_date ? isoToDate(row.scheduled_date) : '',
    time: timeRangeText(row.start_time, row.end_time),
    where: row.location || '',
    link: row.link || '',
    people: people.map((rp) => String(rp.person_id)),
    notes: notes.map((n) => ({ author: n.author, text: n.text, time: relTime(n.created_at, now) })),
  };
}

/* View round → db:rounds.set input. */
export function roundInput(r: RoundView): RoundInput {
  // '' splits to one empty slot and '10:00' to a single time, so both ends
  // fall back to null rather than being asserted into a pair.
  const [start = null, end = null] = r.time.split(/\s*[–-]\s*/).map((t) => t.trim() || null);
  return {
    id: r.dbId,
    state: r.state,
    title: r.title,
    stage: r.stage || null,
    scheduled_date: dateToISO(r.date) || null,
    start_time: start,
    end_time: end,
    location: r.where || null,
    link: r.link || null,
    people: r.people.map(Number).filter((n) => Number.isFinite(n)),
  };
}

export function indexSnapshot(snap: DbSnapshot, now = new Date()): DomainState {
  const peopleByRound = groupBy(snap.roundPeople, (rp) => rp.round_id);
  const notesByRound = groupBy(snap.roundNotes, (n) => n.round_id);
  const roundRowsByApp = groupBy(snap.rounds, (r) => r.application_id);

  const roundsState: Record<string, RoundView[]> = {};
  for (const [appId, rows] of Object.entries(roundRowsByApp)) {
    roundsState[appId] = rows.map((r) =>
      roundView(r, peopleByRound[String(r.id)] ?? [], notesByRound[String(r.id)] ?? [], now),
    );
  }

  /* Runs arrive ordered by application and id, so the last one per
     application is the latest. */
  const stepsByRun = groupBy(snap.agentSteps, (s) => s.run_id);
  const agentRuns: Record<string, AgentRunView> = {};
  for (const run of snap.agentRuns) {
    agentRuns[run.application_id] = { run, steps: stepsByRun[String(run.id)] ?? [] };
  }

  return {
    applications: Object.fromEntries(snap.applications.map((a) => [a.id, a])),
    companies: Object.fromEntries(snap.companies.map((c) => [c.id, c])),
    factsByApp: groupBy(snap.facts, (f) => f.application_id),
    people: Object.fromEntries(snap.people.map((p) => [String(p.id), personView(p)])),
    linksByApp: groupBy(snap.applicationPeople, (l) => l.application_id),
    commentsByApp: groupBy(snap.comments, (c) => c.application_id),
    attachmentsByComment: groupBy(snap.commentAttachments, (a) => a.comment_id),
    roundsState,
    followupsByApp: groupBy(snap.followups, (f) => f.application_id),
    documentsByApp: groupBy(snap.documents, (d) => d.application_id),
    activitiesByApp: groupBy(snap.activities, (a) => a.application_id),
    profileFacts: snap.profileFacts,
    locations: snap.locations.map((l) => l.name),
    roles: snap.roles.map((r) => r.name),
    agentRuns,
    board: boardFrom(snap.applications),
  };
}
