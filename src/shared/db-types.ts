/* Row types for every table in bewerbungen.db, shared between the Electron
   main process (schema, seed, repo) and the renderer (snapshot state).
   Mirrors the CREATE TABLE statements in electron/db/schema.ts — the two must
   move together. The closed value sets these rows carry are the enums in
   ./enums.ts. */

import type {
  AgentRunStatus,
  AgentStepKey,
  AgentStepStatus,
  Assignee,
  Author,
  DocumentKind,
  DocumentLanguage,
  EditKind,
  FactKind,
  Interest,
  LinkKind,
  RoundState,
  TemplateKind,
} from './enums.ts';

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
  /* `website` once held the careers page, and the seed still fills it; no
     sidebar label routes to it any more — "Firmenseite" writes `homepage` —
     so nothing reads it back. The column stays for old rows. */
  website: string | null;
  homepage: string | null;
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
  interest: Interest;
  channel: string | null;
  stage_id: string;
  stage_position: number;
  summary: string | null;
  applied_at: string | null;
  applied_via: string | null;
  /* The job listing's source from the create dialog: its URL, or the pasted
     listing text when there was no link. At most one is set. */
  posting_url: string | null;
  posting_text: string | null;
  /* Why the applicant is interested in exactly this position — typed into the
     create dialog, read by the letter generation. */
  interest_reason: string | null;
  assignee: Assignee | null;
  /* Which side of the template slots a run reads and what its files are
     called. Null until Kepler read the posting or the user chose — an
     explicit choice is never overwritten by detection. */
  language: DocumentLanguage | null;
  created_at: string;
  updated_at: string;
}

export interface FactRow {
  id: number;
  application_id: string;
  label: string;
  value: string;
  kind: FactKind | null;
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
  company_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface LocationRow {
  id: number;
  name: string;
  created_at: string;
}

export interface RoleRow {
  id: number;
  name: string;
  created_at: string;
}

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

/* A file attached to a comment. `name` is what the file was picked under and
   what the thread shows; `file_path` is where the copy landed, relative to
   userData. Attachments are immutable — added at send, removed with the
   comment. */
export interface CommentAttachmentRow {
  id: number;
  comment_id: number;
  name: string;
  file_path: string;
  size: number;
  created_at: string;
}

/* What db:comments.add receives per staged file — produced by
   window.desktop.attachments.copy, which put the bytes on disk first. */
export interface AttachmentInput {
  name: string;
  filePath: string;
  size: number;
}

/* What db:documents.add receives per file — produced by
   window.desktop.documents.add, which put the bytes on disk first. */
export interface DocumentFileInput {
  filePath: string;
  title: string;
}

/* One change Kepler made to a document, kept beside the comment that reported
   it. find_text/replace_text rather than find/replace: `replace` is a SQLite
   function name, and a column of that name would need quoting at every use.
   undone_at turns the comment's retry icon back into "try again" once its set
   has been applied backwards, and keeps it from being reversed twice. */
export interface CommentEditRow {
  id: number;
  comment_id: number;
  document: DocumentKind;
  kind: EditKind;
  find_text: string;
  replace_text: string;
  after_text: string | null;
  position: number;
  undone_at: string | null;
}

export interface RoundRow {
  id: number;
  application_id: string;
  position: number;
  state: RoundState;
  title: string;
  /* One of the board's interview stages, null for unstaged custom rounds. */
  stage: string | null;
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
  /* When the user ticked the follow-up off as sent; null while it is open. */
  completed_at: string | null;
}

export interface DocumentRow {
  id: number;
  application_id: string;
  kind: DocumentKind;
  title: string;
  /* Both relative to userData/documents/<application_id>/, NULL until a real
     file exists: the HTML that gets edited, and the PDF rendered from it. */
  file_path: string | null;
  pdf_path: string | null;
  /* The label of the profile-template Fassung this file was generated from;
     NULL for hand-uploaded files and documents from before Fassungen. */
  template_label: string | null;
  created_at: string;
  updated_at: string;
}

/* One change Kepler wants to make to a generated document. Not a stored row —
   carried on a comment and placed or reversed by electron/agent/edits.ts,
   which is the only reader of the shape. Declared here rather than there so
   the database layer (electron/db/repo.ts) can consume it without importing
   from the agent. */
export interface DocumentEdit {
  document: DocumentKind;
  kind: EditKind;
  /* The passage as the document words it today. Empty for an insertion. */
  find: string;
  /* What takes its place. Empty for a deletion. */
  replace: string;
  /* Where an insertion goes: the passage it follows. Also filled on a
     deletion, so the reversal knows where to put the text back. */
  after: string | null;
}

export interface ActivityRow {
  id: number;
  application_id: string;
  author: Author;
  text: string;
  created_at: string;
}

/* One thing worth knowing about the applicant that neither the CV nor the cover
   letter says. Belongs to the profile, so it has no application_id. */
export interface ProfileFactRow {
  id: number;
  text: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/* One Kepler launch. Re-runs insert a new row; the renderer shows only the
   latest per application, older rows are history. */
export interface AgentRunRow {
  id: number;
  application_id: string;
  status: AgentRunStatus;
  /* The panel headline — always the current step's running form. */
  label: string;
  error: string | null;
  /* The listing text the run worked from (fetched or pasted) — the input a
     retried step resumes with instead of scraping again. */
  listing: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AgentStepRow {
  id: number;
  run_id: number;
  position: number;
  key: AgentStepKey;
  status: AgentStepStatus;
  /* Fully rendered German label; only the {m}/{doc} chip placeholders remain
     for the panel to resolve. */
  label: string;
  /* Which profile template the step reads — drives the {doc} chip. */
  doc: TemplateKind | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/* Input shape for the full-list round replace (db:rounds.set). */
export interface RoundInput {
  id?: number;
  state: RoundState;
  title: string;
  stage: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  link: string | null;
  people: number[];
}

export interface CreateApplicationResult {
  application: ApplicationRow;
  company: CompanyRow;
  rounds: RoundRow[];
  followups: FollowupRow[];
  documents: DocumentRow[];
  comments: CommentRow[];
  /* The card's people links — empty on create, filled as contacts are added
       at the card. */
  people: ApplicationPersonRow[];
  /* Stage siblings whose position shifted to make room. */
  applications: ApplicationRow[];
}

/* stage_id is not patchable — stage changes go through applications.move,
   which keeps stage_position contiguous. */
export type ApplicationPatch = Partial<
  Pick<
    ApplicationRow,
    | 'role'
    | 'interest'
    | 'channel'
    | 'summary'
    | 'applied_at'
    | 'applied_via'
    | 'posting_url'
    | 'posting_text'
    | 'interest_reason'
    | 'assignee'
    | 'language'
  >
>;
export type CompanyPatch = Partial<
  Pick<CompanyRow, 'name' | 'sector' | 'headcount' | 'website' | 'homepage' | 'email' | 'phone' | 'notes'>
>;
/* `company` is the company's name — the repo finds or creates the row, the
   same way relinking Unternehmen on a card does. null detaches; leaving it out
   keeps the current company. */
export type PersonPatch = Partial<
  Pick<PersonRow, 'name' | 'role' | 'email' | 'phone' | 'linkedin' | 'initials'>
> & { company?: string | null };
export interface PersonInput {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  company?: string | null;
}
/* A person write hands back the company it resolved to, which may be new. */
export interface PersonWithCompany {
  person: PersonRow;
  company: CompanyRow | null;
}

/* The renderer-facing async API exposed as window.desktop.db. Preload maps
   each method onto its db:* IPC channel; the main side is electron/db/repo.ts. */
export interface DbApi {
  load(): Promise<DbSnapshot>;
  applications: {
    create(input: {
      role: string;
      company: string;
      channel: string | null;
      postingUrl?: string | null;
      postingText?: string | null;
      interestReason?: string | null;
      language?: DocumentLanguage | null;
    }): Promise<CreateApplicationResult>;
    update(id: string, patch: ApplicationPatch): Promise<ApplicationRow>;
    move(id: string, toStageId: string, toIndex: number): Promise<ApplicationRow[]>;
    delete(id: string): Promise<void>;
    relinkCompany(id: string, name: string): Promise<{ application: ApplicationRow; company: CompanyRow }>;
  };
  companies: {
    update(companyId: number, patch: CompanyPatch): Promise<CompanyRow>;
    /* Rejects while a card still points at the company. */
    delete(companyId: number): Promise<void>;
  };
  locations: {
    /* Rejects while a card's Standort still names it. */
    delete(name: string): Promise<void>;
  };
  roles: {
    /* Rejects while a card or a person still carries the role. */
    delete(name: string): Promise<void>;
  };
  facts: {
    upsert(applicationId: string, label: string, value: string, kind: FactKind | null): Promise<FactRow>;
    delete(applicationId: string, label: string): Promise<void>;
  };
  comments: {
    add(
      applicationId: string,
      author: Author,
      text: string,
      attachments?: AttachmentInput[],
    ): Promise<{ comment: CommentRow; attachments: CommentAttachmentRow[] }>;
    update(commentId: number, text: string): Promise<CommentRow>;
    /* Resolves to the stored file paths of the comment's attachments, which
       the main process removes from disk after the rows cascade. */
    delete(commentId: number): Promise<string[]>;
  };
  rounds: {
    set(
      applicationId: string,
      rounds: RoundInput[],
    ): Promise<{ rounds: RoundRow[]; roundPeople: RoundPersonRow[] }>;
  };
  roundNotes: {
    add(roundId: number, author: Author, text: string): Promise<RoundNoteRow>;
  };
  people: {
    create(input: PersonInput): Promise<PersonWithCompany>;
    update(personId: number, patch: PersonPatch): Promise<PersonWithCompany>;
    delete(personId: number): Promise<void>;
  };
  applicationPeople: {
    set(applicationId: string, kind: LinkKind, personIds: number[]): Promise<ApplicationPersonRow[]>;
  };
  followups: {
    setDue(followupId: number, dueAt: string): Promise<FollowupRow>;
    setCompleted(followupId: number, completedAt: string | null): Promise<FollowupRow>;
    saveEmail(followupId: number, subject: string, text: string): Promise<FollowupRow>;
  };
  documents: {
    /* One row per file the main process just copied in, in that order. */
    add(applicationId: string, files: DocumentFileInput[]): Promise<DocumentRow[]>;
    /* Resolves to the stored paths of the row's renditions, which the main
       process removes from disk after the row is gone. */
    delete(documentId: number): Promise<string[]>;
    setFile(
      documentId: number,
      filePath: string,
      pdfPath: string | null,
      templateLabel: string | null,
    ): Promise<DocumentRow>;
  };
  activities: {
    add(applicationId: string, author: Author, text: string): Promise<ActivityRow>;
  };
  profileFacts: {
    add(text: string): Promise<ProfileFactRow>;
    update(factId: number, text: string): Promise<ProfileFactRow>;
    delete(factId: number): Promise<void>;
    /* Every id, in the order the list now reads; positions are rewritten to
       match. Resolves to the full list in its new order. */
    reorder(ids: number[]): Promise<ProfileFactRow[]>;
  };
}

/* Everything db:load returns — the renderer's entire domain state. */
export interface DbSnapshot {
  stages: StageRow[];
  companies: CompanyRow[];
  applications: ApplicationRow[];
  facts: FactRow[];
  people: PersonRow[];
  locations: LocationRow[];
  roles: RoleRow[];
  applicationPeople: ApplicationPersonRow[];
  comments: CommentRow[];
  commentAttachments: CommentAttachmentRow[];
  commentEdits: CommentEditRow[];
  rounds: RoundRow[];
  roundPeople: RoundPersonRow[];
  roundNotes: RoundNoteRow[];
  followups: FollowupRow[];
  documents: DocumentRow[];
  activities: ActivityRow[];
  profileFacts: ProfileFactRow[];
  agentRuns: AgentRunRow[];
  agentSteps: AgentStepRow[];
}
