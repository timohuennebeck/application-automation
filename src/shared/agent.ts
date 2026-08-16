/* The main→renderer contract for Kepler runs. Events ride the agent:event
   push channel; agent:start answers with AgentStartResult. */
import type { AgentRunRow, AgentStepRow } from './db-types.ts';

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
