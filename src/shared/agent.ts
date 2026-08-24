/* The main→renderer contract for Kepler runs. Events ride the agent:event
   push channel; agent:start answers with AgentStartResult. */
import type { AgentRunRow, AgentStepRow, CommentEditRow, CommentRow } from './db-types.ts';
import type { DocumentKind } from './enums.ts';

export interface AgentEvent {
  /* The run as it now stands — always present, every event. */
  run: AgentRunRow;
  /* The full step list; sent when the run is created or many steps changed. */
  steps?: AgentStepRow[];
  /* A single step that changed; cheaper than resending the list. */
  step?: AgentStepRow;
  /* Set when the step also wrote domain data (company, contacts, documents,
     comments) — the renderer re-pulls db:load to pick it up. */
  refresh?: boolean;
}

export interface AgentStartResult {
  ok: boolean;
  /* German reason when ok is false — shown as-is. */
  error?: string;
}

/* The headline of a run that ended before finishing — stop, crash or failure
   alike. Shared because both sides show it: the main process writes it on the
   run row, the renderer heads the panel and the card strip with it. */
export const INTERRUPTED_HEADLINE = 'Kepler wurde unterbrochen';

/* Asking for other ways to say one marked passage of a finished letter. The
   letter travels as text rather than being read off disk: what the user marked
   is what they are looking at, replacements they have not saved included. */
export interface VariantsRequest {
  applicationId: string;
  /* Names this one rewrite so it can be stopped on its own. The editor puts a
     stop on every passage it is waiting for, and that stop has to mean that
     passage — several can be in the air on the same card. Required: the stop
     beside a passage is the only way to call off one rewrite without calling
     off its neighbours, so a nameless call would be unstoppable on its own. */
  callId: string;
  /* The marked passage as it currently reads. */
  passage: string;
  /* The whole letter as plain text, for the surrounding sentence. */
  letter: string;
  /* What the user typed into the composer; null means "just try again". */
  instruction: string | null;
}

export type VariantsResult =
  /* Suggestions already escaped down to the inline tags a letter may hold, so
     the renderer can put one straight into the document. */
  | { ok: true; variants: string[] }
  /* German reason — shown as-is. */
  | { ok: false; error: string };

/* A comment that addressed Kepler. Only the comment's identity travels: the
   main process reads the thread and the card itself, so the answer is drawn
   from what is stored, not from what the renderer happened to hold. */
export interface AskRequest {
  applicationId: string;
  commentId: number;
  /* The document the editor currently has open on this card, or null. The
     main process has no view of renderer state, and Kepler must not swap a
     file out from under a screen the user is typing in. */
  openDocument: DocumentKind | null;
}

export type AskResult =
  /* The reply, already written into the thread as a Kepler comment, and the
     edit set it placed — empty when the answer changed nothing. */
  /* `pdfError`: the change itself stands, but Chromium could not re-print
     the PDF beside it. An undo posts no comment of its own, so this is the
     only way that half reaches the thread — the forward direction appends
     the same sentence to the reply's prose instead. */
  | { ok: true; comment: CommentRow; edits: CommentEditRow[]; pdfError?: string | null }
  /* German reason — shown in the thread as-is. */
  | { ok: false; error: string };
