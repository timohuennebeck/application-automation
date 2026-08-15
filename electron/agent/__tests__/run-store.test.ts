import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo } from '../../db/repo.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { AgentRunStatus, AgentStepKey, AgentStepStatus, TemplateKind } from '../../../src/shared/enums.ts';

const NOW = new Date('2026-08-14T09:00:00.000Z');

const STEPS = [
  { key: AgentStepKey.EXTRACT, label: 'Firmendetails ergänzen' },
  { key: AgentStepKey.READ_CV, label: 'Hochgeladenen {doc} einlesen', doc: TemplateKind.LEBENSLAUF },
  { key: AgentStepKey.COMMENT, label: 'Kommentar an {m} mit Bewerbungslink hinterlassen' },
];

let db: DatabaseSync;
let runs: RunStore;
let appId: string;
beforeEach(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, NOW);
  const repo = createRepo(db, () => NOW);
  appId = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null }).application.id;
  runs = createRunStore(db, () => NOW);
});

describe('run store', () => {
  it('creates a queued run whose steps all wait in order', () => {
    const { run, steps } = runs.createRun(appId, 'Kepler wartet in der Warteschlange…', STEPS);

    expect(run).toMatchObject({
      application_id: appId,
      status: AgentRunStatus.QUEUED,
      label: 'Kepler wartet in der Warteschlange…',
      error: null,
      started_at: NOW.toISOString(),
      finished_at: null,
    });
    expect(steps.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(steps.map((s) => s.key)).toEqual(STEPS.map((s) => s.key));
    expect(steps.every((s) => s.status === AgentStepStatus.WAIT)).toBe(true);
    expect(steps[1].doc).toBe(TemplateKind.LEBENSLAUF);
    expect(steps[2].doc).toBeNull();
  });

  it('reports the active run only while it is queued or running', () => {
    expect(runs.activeRun(appId)).toBeUndefined();
    const { run } = runs.createRun(appId, 'x', STEPS);
    expect(runs.activeRun(appId)?.id).toBe(run.id);

    runs.startRun(run.id, 'Firmendetails werden ergänzt…');
    expect(runs.activeRun(appId)?.status).toBe(AgentRunStatus.RUNNING);

    runs.finishRun(run.id, 'Fertig');
    expect(runs.activeRun(appId)).toBeUndefined();
  });

  it('advances a step through run and done with timestamps and fresh labels', () => {
    const { run, steps } = runs.createRun(appId, 'x', STEPS);

    const running = runs.startStep(steps[0].id, 'Firmendetails werden ergänzt…');
    expect(running).toMatchObject({
      status: AgentStepStatus.RUN,
      label: 'Firmendetails werden ergänzt…',
      started_at: NOW.toISOString(),
      finished_at: null,
    });

    const done = runs.finishStep(steps[0].id, 'Firmendetails ergänzt');
    expect(done).toMatchObject({
      status: AgentStepStatus.DONE,
      label: 'Firmendetails ergänzt',
      finished_at: NOW.toISOString(),
    });
    expect(runs.stepsFor(run.id)[0].status).toBe(AgentStepStatus.DONE);
  });

  it('rewrites a waiting label once the company name is known', () => {
    const { steps } = runs.createRun(appId, 'x', STEPS);
    const row = runs.relabelStep(steps[1].id, 'Lebenslauf für Acme GmbH erstellen');
    expect(row.label).toBe('Lebenslauf für Acme GmbH erstellen');
    expect(row.status).toBe(AgentStepStatus.WAIT);
  });

  it('fails a step and its run with the German error, leaving the rest waiting', () => {
    const { run, steps } = runs.createRun(appId, 'x', STEPS);
    runs.startRun(run.id, 'x');
    runs.startStep(steps[0].id, 'x');

    runs.failStep(steps[0].id, 'Firmendetails ergänzen', 'Die Stellenanzeige konnte nicht geladen werden.');
    const failed = runs.failRun(run.id, 'Fehlgeschlagen', 'Die Stellenanzeige konnte nicht geladen werden.');

    expect(failed).toMatchObject({
      status: AgentRunStatus.FAILED,
      error: 'Die Stellenanzeige konnte nicht geladen werden.',
      finished_at: NOW.toISOString(),
    });
    const rows = runs.stepsFor(run.id);
    expect(rows[0]).toMatchObject({
      status: AgentStepStatus.ERROR,
      error: 'Die Stellenanzeige konnte nicht geladen werden.',
    });
    expect(rows[1].status).toBe(AgentStepStatus.WAIT);
    expect(runs.activeRun(appId)).toBeUndefined();
  });

  it('keeps the fetched listing on the run for later retries', () => {
    const { run } = runs.createRun(appId, 'x', STEPS);
    expect(run.listing).toBeNull();
    runs.setListing(run.id, 'Stellenanzeige: …');
    expect(runs.getRun(run.id).listing).toBe('Stellenanzeige: …');
  });

  /* A step retry rewinds exactly one step and puts the run back in line —
     everything already done stays done. */
  it('resets a failed step to waiting and requeues its run', () => {
    const { run, steps } = runs.createRun(appId, 'x', STEPS);
    runs.startRun(run.id, 'x');
    runs.finishStep(steps[0].id, 'Firmendetails ergänzt');
    runs.startStep(steps[1].id, 'x');
    runs.failStep(steps[1].id, 'Hochgeladenen {doc} einlesen', 'Keine Vorlage.');
    runs.failRun(run.id, 'Kepler wurde unterbrochen', 'Keine Vorlage.');

    const step = runs.resetStep(steps[1].id, 'Hochgeladenen {doc} einlesen');
    const requeued = runs.requeueRun(run.id, 'Kepler wartet in der Warteschlange…');

    expect(step).toMatchObject({
      status: AgentStepStatus.WAIT,
      error: null,
      started_at: null,
      finished_at: null,
    });
    expect(requeued).toMatchObject({
      status: AgentRunStatus.QUEUED,
      error: null,
      finished_at: null,
    });
    expect(runs.stepsFor(run.id)[0].status).toBe(AgentStepStatus.DONE);
    expect(runs.activeRun(appId)?.id).toBe(run.id);
  });

  /* A finished step or run carries no error — even when a stale one was
     written in between (e.g. a second instance's boot recovery clobbering an
     in-flight run). */
  it('clears stale errors when a step and its run finish', () => {
    const { run, steps } = runs.createRun(appId, 'x', STEPS);
    runs.startRun(run.id, 'x');
    runs.startStep(steps[0].id, 'x');
    db.prepare('UPDATE agent_steps SET error = ? WHERE id = ?').run('Abgebrochen.', steps[0].id);
    db.prepare('UPDATE agent_runs SET error = ? WHERE id = ?').run('Abgebrochen.', run.id);

    expect(runs.finishStep(steps[0].id, 'Firmendetails ergänzt').error).toBeNull();
    expect(runs.finishRun(run.id, 'Alle Schritte erledigt').error).toBeNull();
  });

  /* The app quit mid-run: whatever was in flight is declared failed at boot,
     finished runs stay exactly as they ended. */
  it('recovers orphaned runs at boot and leaves finished ones alone', () => {
    const { run: orphan, steps } = runs.createRun(appId, 'x', STEPS);
    runs.startRun(orphan.id, 'x');
    runs.startStep(steps[0].id, 'x');

    const { run: finished } = runs.createRun(appId, 'x', STEPS);
    runs.finishRun(finished.id, 'Fertig');

    runs.recoverOrphans();

    expect(runs.getRun(orphan.id)).toMatchObject({
      status: AgentRunStatus.FAILED,
      error: 'Abgebrochen — die App wurde beendet.',
      finished_at: NOW.toISOString(),
    });
    expect(runs.stepsFor(orphan.id)[0].status).toBe(AgentStepStatus.ERROR);
    expect(runs.stepsFor(orphan.id)[1].status).toBe(AgentStepStatus.WAIT);
    expect(runs.getRun(finished.id).status).toBe(AgentRunStatus.DONE);
    expect(runs.getRun(finished.id).error).toBeNull();
  });
});
