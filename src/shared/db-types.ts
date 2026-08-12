/* Row types for every table in bewerbungen.db, shared between the Electron
   main process (schema, seed, repo) and the renderer (snapshot state).
   Mirrors docs/superpowers/specs/2026-08-12-sqlite-persistence-design.md. */

export type Author = 'Du' | 'Kepler';

export interface StageRow {
  id: string;
  title: string;
  position: number;
}

export interface CompanyRow {
  id: number;
  name: string;
  sector: string | null;
  headcount: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRow {
  id: string;
  role: string;
  company_id: number;
  interest: string;
  channel: string | null;
  stage_id: string;
  stage_position: number;
  summary: string | null;
  applied_at: string | null;
  applied_via: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

export type FactKind = 'select' | 'link' | null;

export interface FactRow {
  id: number;
  application_id: string;
  label: string;
  value: string;
  kind: FactKind;
  position: number;
}

export interface PersonRow {
  id: number;
  name: string;
  role: string | null;
  initials: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export type LinkKind = 'contact' | 'pool' | 'email';

export interface ApplicationPersonRow {
  application_id: string;
  person_id: number;
  kind: LinkKind;
  position: number;
}

export interface CommentRow {
  id: number;
  application_id: string;
  author: Author;
  text: string;
  created_at: string;
  edited_at: string | null;
}

export type RoundState = 'done' | 'next' | 'open';

export interface RoundRow {
  id: number;
  application_id: string;
  position: number;
  state: RoundState;
  title: string;
  /* Local wall-clock appointment: date + optional start/end range. */
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  link: string | null;
}

export interface RoundPersonRow {
  round_id: number;
  person_id: number;
  position: number;
}

export interface RoundNoteRow {
  id: number;
  round_id: number;
  author: Author;
  text: string;
  created_at: string;
}

export interface FollowupRow {
  id: number;
  application_id: string;
  label: string;
  due_at: string;
  position: number;
  /* Drafts are generated once and stored; never regenerated on open. */
  email_subject: string | null;
  email_text: string | null;
  generated_at: string | null;
}

export type DocumentKind = 'cover-letter' | 'lebenslauf' | 'other';

export interface DocumentRow {
  id: number;
  application_id: string;
  kind: DocumentKind;
  title: string;
  format: string;
  /* Relative to userData/documents/<application_id>/; NULL until a real file exists. */
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: number;
  application_id: string;
  author: Author;
  text: string;
  created_at: string;
}

/* Everything db:load returns — the renderer's entire domain state. */
export interface DbSnapshot {
  stages: StageRow[];
  companies: CompanyRow[];
  applications: ApplicationRow[];
  facts: FactRow[];
  people: PersonRow[];
  applicationPeople: ApplicationPersonRow[];
  comments: CommentRow[];
  rounds: RoundRow[];
  roundPeople: RoundPersonRow[];
  roundNotes: RoundNoteRow[];
  followups: FollowupRow[];
  documents: DocumentRow[];
  activities: ActivityRow[];
}
