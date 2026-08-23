/* Every closed value set that is stored in the database or crosses the
   main↔renderer boundary. The member value is exactly what SQLite holds, so
   this file is the only place those literals may appear — everywhere else
   compares against the member (RoundState.DONE, LinkKind.CONTACT, …).

   These are const objects rather than `enum` declarations because both
   tsconfigs run with erasableSyntaxOnly, which rules out enum syntax. Usage is
   identical, and each name is both the value namespace and the type.

   Renderer-only value sets (dot shapes, popover variants, agent steps) live
   next to the component that owns them. */

export const Author = {
  DU: 'DU',
  KEPLER: 'KEPLER',
} as const;
export type Author = (typeof Author)[keyof typeof Author];

/* What the UI calls each author. The stored value is an identifier; these are
   the German names shown in comments, notes and the history. */
export const AUTHOR_LABEL: Record<Author, string> = {
  [Author.DU]: 'Du',
  [Author.KEPLER]: 'Kepler',
};

export const RoundState = {
  DONE: 'DONE',
  NEXT: 'NEXT',
  OPEN: 'OPEN',
} as const;
export type RoundState = (typeof RoundState)[keyof typeof RoundState];

/* How a person is attached to an application: the card's contacts, its
   suggestion pool for interviews, or the follow-up email's recipients. */
export const LinkKind = {
  CONTACT: 'CONTACT',
  POOL: 'POOL',
  EMAIL: 'EMAIL',
} as const;
export type LinkKind = (typeof LinkKind)[keyof typeof LinkKind];

/* How a facts row is rendered. The column stays nullable — plain text has no
   kind at all. */
export const FactKind = {
  SELECT: 'SELECT',
  LINK: 'LINK',
} as const;
export type FactKind = (typeof FactKind)[keyof typeof FactKind];

export const DocumentKind = {
  COVER_LETTER: 'COVER_LETTER',
  LEBENSLAUF: 'LEBENSLAUF',
  OTHER: 'OTHER',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

/* The two documents kept once for the whole profile, not per application: the
   CV and the cover letter the agent fills in for each new posting. There are
   exactly two, so this is deliberately not DocumentKind — an OTHER template
   would have no slot to live in. */
export const TemplateKind = {
  LEBENSLAUF: 'LEBENSLAUF',
  ANSCHREIBEN: 'ANSCHREIBEN',
} as const;
export type TemplateKind = (typeof TemplateKind)[keyof typeof TemplateKind];

/* The language an application is conducted in — which side of each template
   slot Kepler reads and what the generated files are called. Stored on the
   application (null until Kepler has read the posting) and used as a path
   segment under each slot, so the values are short and lowercase. */
export const DocumentLanguage = {
  DE: 'de',
  EN: 'en',
} as const;
export type DocumentLanguage = (typeof DocumentLanguage)[keyof typeof DocumentLanguage];

/* What the UI calls each language. */
export const LANGUAGE_TITLES: Record<DocumentLanguage, string> = {
  [DocumentLanguage.DE]: 'Deutsch',
  [DocumentLanguage.EN]: 'Englisch',
};

/* What the UI (and Kepler's error messages) call each template slot. */
export const TEMPLATE_TITLES: Record<TemplateKind, string> = {
  [TemplateKind.LEBENSLAUF]: 'Lebenslauf',
  [TemplateKind.ANSCHREIBEN]: 'Anschreiben',
};

/* Who owns a card. Kepler is the only assignee so far; NULL means nobody. */
export const Assignee = {
  KEPLER: 'kepler',
} as const;
export type Assignee = (typeof Assignee)[keyof typeof Assignee];

/* Lifecycle of one Kepler run. QUEUED rows wait their turn in the main
   process's FIFO; everything past FAILED/DONE is history. */
export const AgentRunStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

export const AgentStepStatus = {
  WAIT: 'WAIT',
  RUN: 'RUN',
  DONE: 'DONE',
  ERROR: 'ERROR',
} as const;
export type AgentStepStatus = (typeof AgentStepStatus)[keyof typeof AgentStepStatus];

/* What a step does, independent of its German label. FETCH only exists on
   runs that have a posting URL — pasted text skips straight to EXTRACT. */
export const AgentStepKey = {
  FETCH: 'FETCH',
  EXTRACT: 'EXTRACT',
  CONTACTS: 'CONTACTS',
  READ_CV: 'READ_CV',
  READ_LETTER: 'READ_LETTER',
  GEN_CV: 'GEN_CV',
  GEN_LETTER: 'GEN_LETTER',
  VALIDATE: 'VALIDATE',
  COMMENT: 'COMMENT',
} as const;
export type AgentStepKey = (typeof AgentStepKey)[keyof typeof AgentStepKey];

export const Interest = {
  URGENT: 'URGENT',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
} as const;
export type Interest = (typeof Interest)[keyof typeof Interest];
