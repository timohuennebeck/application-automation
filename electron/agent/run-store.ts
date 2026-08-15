/* All SQL for Kepler's run rows, one synchronous method per transition. The
   orchestrator composes these; the German strings themselves come from
   labels.ts — this file never invents copy, it only stores what it is given.
   The one string it owns is the boot-recovery verdict, because recovery runs
   before any orchestrator exists. */
import type { DatabaseSync } from 'node:sqlite';
import type { AgentRunRow, AgentStepRow } from '../../src/shared/db-types.ts';
import { AgentRunStatus, AgentStepStatus } from '../../src/shared/enums.ts';
import type { AgentStepKey, TemplateKind } from '../../src/shared/enums.ts';

export interface StepInput {
  key: AgentStepKey;
  label: string;
  doc?: TemplateKind;
}

const ORPHAN_ERROR = 'Abgebrochen — die App wurde beendet.';

export type RunStore = ReturnType<typeof createRunStore>;

export function createRunStore(db: DatabaseSync, nowFn: () => Date = () => new Date()) {
  const nowISO = () => nowFn().toISOString();

  const getRun = (runId: number): AgentRunRow =>
    db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as unknown as AgentRunRow;
  const getStep = (stepId: number): AgentStepRow =>
    db.prepare('SELECT * FROM agent_steps WHERE id = ?').get(stepId) as unknown as AgentStepRow;
  const stepsFor = (runId: number): AgentStepRow[] =>
    db
      .prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position')
      .all(runId) as unknown as AgentStepRow[];

  return {
    getRun,
    stepsFor,

    createRun(
      applicationId: string,
      label: string,
      steps: StepInput[],
    ): { run: AgentRunRow; steps: AgentStepRow[] } {
      const res = db
        .prepare('INSERT INTO agent_runs (application_id, status, label, started_at) VALUES (?,?,?,?)')
        .run(applicationId, AgentRunStatus.QUEUED, label, nowISO());
      const runId = Number(res.lastInsertRowid);
      const ins = db.prepare(
        'INSERT INTO agent_steps (run_id, position, key, status, label, doc) VALUES (?,?,?,?,?,?)',
      );
      steps.forEach((s, i) => ins.run(runId, i, s.key, AgentStepStatus.WAIT, s.label, s.doc ?? null));
      return { run: getRun(runId), steps: stepsFor(runId) };
    },

    /* The most recent run, whatever state it ended in. */
    latestRun(applicationId: string): AgentRunRow | undefined {
      return db
        .prepare('SELECT * FROM agent_runs WHERE application_id = ? ORDER BY id DESC')
        .get(applicationId) as AgentRunRow | undefined;
    },

    /* The run the record is locked behind — at most one per application. */
    activeRun(applicationId: string): AgentRunRow | undefined {
      return db
        .prepare('SELECT * FROM agent_runs WHERE application_id = ? AND status IN (?,?) ORDER BY id DESC')
        .get(applicationId, AgentRunStatus.QUEUED, AgentRunStatus.RUNNING) as AgentRunRow | undefined;
    },

    startRun(runId: number, label: string): AgentRunRow {
      db.prepare('UPDATE agent_runs SET status = ?, label = ? WHERE id = ?').run(
        AgentRunStatus.RUNNING,
        label,
        runId,
      );
      return getRun(runId);
    },

    setRunLabel(runId: number, label: string): AgentRunRow {
      db.prepare('UPDATE agent_runs SET label = ? WHERE id = ?').run(label, runId);
      return getRun(runId);
    },

    /* error is cleared explicitly: a stale one may have been written in
       between (another instance's boot recovery), and a done run has none. */
    finishRun(runId: number, label: string): AgentRunRow {
      db.prepare(
        'UPDATE agent_runs SET status = ?, label = ?, error = NULL, finished_at = ? WHERE id = ?',
      ).run(AgentRunStatus.DONE, label, nowISO(), runId);
      return getRun(runId);
    },

    failRun(runId: number, label: string, error: string): AgentRunRow {
      db.prepare('UPDATE agent_runs SET status = ?, label = ?, error = ?, finished_at = ? WHERE id = ?').run(
        AgentRunStatus.FAILED,
        label,
        error,
        nowISO(),
        runId,
      );
      return getRun(runId);
    },

    startStep(stepId: number, label: string): AgentStepRow {
      db.prepare('UPDATE agent_steps SET status = ?, label = ?, started_at = ? WHERE id = ?').run(
        AgentStepStatus.RUN,
        label,
        nowISO(),
        stepId,
      );
      return getStep(stepId);
    },

    finishStep(stepId: number, label: string): AgentStepRow {
      db.prepare(
        'UPDATE agent_steps SET status = ?, label = ?, error = NULL, finished_at = ? WHERE id = ?',
      ).run(AgentStepStatus.DONE, label, nowISO(), stepId);
      return getStep(stepId);
    },

    failStep(stepId: number, label: string, error: string): AgentStepRow {
      db.prepare('UPDATE agent_steps SET status = ?, label = ?, error = ?, finished_at = ? WHERE id = ?').run(
        AgentStepStatus.ERROR,
        label,
        error,
        nowISO(),
        stepId,
      );
      return getStep(stepId);
    },

    /* Rewrites a waiting step's label once its placeholders can be resolved —
       "Lebenslauf für Unbekanntes Unternehmen erstellen" gets the real name
       after extraction. */
    relabelStep(stepId: number, label: string): AgentStepRow {
      db.prepare('UPDATE agent_steps SET label = ? WHERE id = ?').run(label, stepId);
      return getStep(stepId);
    },

    /* The listing the pipeline worked from, kept for step retries. */
    setListing(runId: number, listing: string): void {
      db.prepare('UPDATE agent_runs SET listing = ? WHERE id = ?').run(listing, runId);
    },

    /* A step retry rewinds exactly one step: back to waiting, as if it had
       never started. Everything already done stays done. */
    resetStep(stepId: number, label: string): AgentStepRow {
      db.prepare(
        'UPDATE agent_steps SET status = ?, label = ?, error = NULL, started_at = NULL, finished_at = NULL WHERE id = ?',
      ).run(AgentStepStatus.WAIT, label, stepId);
      return getStep(stepId);
    },

    /* Puts a failed run back in line behind whatever is queued. */
    requeueRun(runId: number, label: string): AgentRunRow {
      db.prepare(
        'UPDATE agent_runs SET status = ?, label = ?, error = NULL, finished_at = NULL WHERE id = ?',
      ).run(AgentRunStatus.QUEUED, label, runId);
      return getRun(runId);
    },

    /* Boot recovery: the app quit while runs were in flight. Whatever was
       QUEUED or RUNNING is declared failed; steps that never started keep
       waiting so the panel shows where it stopped. */
    recoverOrphans(): void {
      const t = nowISO();
      db.prepare(
        `UPDATE agent_steps SET status = ?, error = ?, finished_at = ?
         WHERE status = ? AND run_id IN (SELECT id FROM agent_runs WHERE status IN (?,?))`,
      ).run(
        AgentStepStatus.ERROR,
        ORPHAN_ERROR,
        t,
        AgentStepStatus.RUN,
        AgentRunStatus.QUEUED,
        AgentRunStatus.RUNNING,
      );
      db.prepare('UPDATE agent_runs SET status = ?, error = ?, finished_at = ? WHERE status IN (?,?)').run(
        AgentRunStatus.FAILED,
        ORPHAN_ERROR,
        t,
        AgentRunStatus.QUEUED,
        AgentRunStatus.RUNNING,
      );
    },
  };
}
