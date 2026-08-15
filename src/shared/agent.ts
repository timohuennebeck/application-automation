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
