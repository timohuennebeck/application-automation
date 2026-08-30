import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo, type Repo } from '../../db/repo.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { createAgentService, type AgentService } from '../service.ts';
import { AgentRunStatus, AgentStepKey, AgentStepStatus } from '../../../src/shared/enums.ts';
import type { AgentEvent } from '../../../src/shared/agent.ts';
import { STOP_ERROR } from '../labels.ts';

const NOW = new Date('2026-08-14T09:00:00.000Z');

let db: DatabaseSync;
let repo: Repo;
let runs: RunStore;
let events: AgentEvent[];
let pipeline: ReturnType<
  typeof vi.fn<(applicationId: string, runId: number, signal: AbortSignal) => Promise<void>>
>;
let service: AgentService;

beforeEach(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, NOW);
  repo = createRepo(db, () => NOW);
  runs = createRunStore(db, () => NOW);
  events = [];
  pipeline = vi.fn(async () => {});
  service = createAgentService({
    repo,
    runs,
    emit: (e) => events.push(e),
    pipeline,
  });
});

const createApp = (input: { postingUrl?: string; postingText?: string }) =>
  repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: 'LinkedIn', ...input })
    .application.id;

describe('agent service', () => {
  it('abandon aborts the run in flight for a deleted card and writes nothing', async () => {
    const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
    let seenSignal: AbortSignal | undefined;
    let release!: () => void;
    pipeline.mockImplementation(
      (_id, _run, signal) =>
        new Promise<void>((resolve) => {
          seenSignal = signal;
          release = resolve;
        }),
    );
    await service.start(appId);
    await Promise.resolve();
    expect(seenSignal?.aborted).toBe(false);

    repo.deleteApplication(appId);
    service.abandon(appId);
    expect(seenSignal?.aborted).toBe(true);
    release();
    await service.whenIdle();
    /* The rows cascaded away with the card; nothing was resurrected. */
    expect(runs.latestRun(appId)).toBeUndefined();
    /* Abandoning a card without a run is a no-op. */
    expect(() => service.abandon('BEW-999')).not.toThrow();
  });

  it('queues a run with the full plan and hands it to the pipeline', async () => {
    const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });

    const res = await service.start(appId);
    await service.whenIdle();

    expect(res).toEqual({ ok: true });
    expect(pipeline).toHaveBeenCalledTimes(1);
    const [calledAppId, runId] = pipeline.mock.calls[0];
    expect(calledAppId).toBe(appId);
    const steps = runs.stepsFor(runId);
    expect(steps[0].key).toBe(AgentStepKey.FETCH);
    expect(steps).toHaveLength(9);
    /* The panel appears the moment the run is queued. */
    expect(events[0].run.status).toBe(AgentRunStatus.QUEUED);
    expect(events[0].steps).toHaveLength(9);
  });

  it('skips the fetch step when only pasted text exists', async () => {
    const appId = createApp({ postingText: 'Wir suchen einen Designer …' });

    await service.start(appId);
    await service.whenIdle();

    const runId = pipeline.mock.calls[0][1];
    expect(runs.stepsFor(runId).map((s) => s.key)).not.toContain(AgentStepKey.FETCH);
  });

  /* After a blocked fetch the user pastes the listing text; the URL is still
     stored, but the re-run must read the text instead of hitting the wall
     again. */
  it('prefers pasted text over the URL and skips the fetch step', async () => {
    const appId = createApp({ postingUrl: 'https://acme.de/jobs/1', postingText: 'Wir suchen …' });

    await service.start(appId);
    await service.whenIdle();

    const runId = pipeline.mock.calls[0][1];
    expect(runs.stepsFor(runId).map((s) => s.key)).not.toContain(AgentStepKey.FETCH);
  });

  it('refuses an application that has no posting source', async () => {
    const appId = createApp({});
    const res = await service.start(appId);
    expect(res.ok).toBe(false);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('refuses a second start while a run is still active', async () => {
    const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
    /* A pipeline that never settles keeps the first run active. */
    pipeline.mockImplementation(() => new Promise(() => {}));

    await service.start(appId);
    const second = await service.start(appId);

    expect(second.ok).toBe(false);
    expect(second.error).toContain('bereits');
  });

  it('refuses an unknown application', async () => {
    const res = await service.start('BEW-999');
    expect(res.ok).toBe(false);
  });

  describe('retry', () => {
    it('rewinds the failed step and hands the same run back to the pipeline', async () => {
      const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
      await service.start(appId);
      await service.whenIdle();
      const runId = pipeline.mock.calls[0][1] as number;
      const step = runs.stepsFor(runId)[1];
      runs.failStep(step.id, step.label, 'kaputt');
      runs.failRun(runId, 'Kepler wurde unterbrochen', 'kaputt');

      const res = await service.retry(appId);
      await service.whenIdle();

      expect(res).toEqual({ ok: true });
      expect(pipeline).toHaveBeenCalledTimes(2);
      expect(pipeline.mock.calls[1][1]).toBe(runId);
      expect(runs.stepsFor(runId)[1].status).toBe(AgentStepStatus.WAIT);
    });

    it('refuses when there is nothing failed to retry', async () => {
      const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
      expect((await service.retry(appId)).ok).toBe(false);

      await service.start(appId);
      await service.whenIdle();
      /* The run finished — a retry would have nothing to rewind. */
      const runId = pipeline.mock.calls[0][1] as number;
      runs.finishRun(runId, 'Fertig');
      expect((await service.retry(appId)).ok).toBe(false);
    });
  });

  describe('stop', () => {
    it('aborts the running pipeline through its signal', async () => {
      const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
      let seen: AbortSignal | undefined;
      pipeline.mockImplementation(
        (_a, _r, signal) =>
          new Promise<void>((resolve) => {
            seen = signal;
            signal.addEventListener('abort', () => resolve());
          }),
      );
      await service.start(appId);

      const res = await service.stop(appId);
      await service.whenIdle();

      expect(res).toEqual({ ok: true });
      expect(seen?.aborted).toBe(true);
    });

    it('settles a queued run at once and lets the retry resume it', async () => {
      const a = createApp({ postingUrl: 'https://acme.de/jobs/1' });
      const b = createApp({ postingUrl: 'https://acme.de/jobs/2' });
      let releaseA!: () => void;
      pipeline.mockImplementationOnce(() => new Promise<void>((r) => (releaseA = r)));
      await service.start(a);
      await service.start(b);

      const res = await service.stop(b);

      expect(res).toEqual({ ok: true });
      const run = runs.latestRun(b)!;
      expect(run.status).toBe(AgentRunStatus.FAILED);
      expect(run.error).toBe(STOP_ERROR);
      const steps = runs.stepsFor(run.id);
      expect(steps[0]).toMatchObject({ status: AgentStepStatus.ERROR, error: STOP_ERROR });
      expect(steps.slice(1).every((s) => s.status === AgentStepStatus.WAIT)).toBe(true);
      expect(events.at(-1)!.run.id).toBe(run.id);
      expect(events.at(-1)!.steps).toHaveLength(9);

      /* The stale queue link reaches the pipeline with an aborted signal; the
         retry's fresh link does not. */
      pipeline.mockImplementation(async () => {});
      expect((await service.retry(b)).ok).toBe(true);
      releaseA();
      await service.whenIdle();
      const callsForB = pipeline.mock.calls.filter((c) => c[0] === b);
      expect(callsForB.map((c) => c[2].aborted)).toEqual([true, false]);
      expect(runs.stepsFor(run.id)[0].status).toBe(AgentStepStatus.WAIT);
    });

    it('refuses when nothing is running', async () => {
      const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
      expect((await service.stop(appId)).ok).toBe(false);
    });
  });

  it('runs pipelines for different cards in parallel', async () => {
    const a = createApp({ postingUrl: 'https://acme.de/jobs/1' });
    const b = createApp({ postingUrl: 'https://acme.de/jobs/2' });
    const order: string[] = [];
    pipeline.mockImplementation(async (appId: string) => {
      order.push('start ' + appId);
      await new Promise((r) => setTimeout(r, 5));
      order.push('end ' + appId);
    });

    await service.start(a);
    await service.start(b);
    await service.whenIdle();

    /* Card b no longer waits for card a: both start before either ends. */
    expect(order).toEqual(['start ' + a, 'start ' + b, 'end ' + a, 'end ' + b]);
  });

  /* The queue chain must survive anything — a backstop that itself throws
     would otherwise leave every later run QUEUED (and its card locked)
     forever. */
  it('keeps the queue alive when even the failure backstop throws', async () => {
    const a = createApp({ postingUrl: 'https://acme.de/jobs/1' });
    const b = createApp({ postingUrl: 'https://acme.de/jobs/2' });
    pipeline.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const originalFailRun = runs.failRun;
    runs.failRun = () => {
      runs.failRun = originalFailRun;
      throw new Error('db gone');
    };

    await service.start(a);
    await service.start(b);
    await service.whenIdle();

    expect(pipeline).toHaveBeenCalledTimes(2);
    expect(pipeline.mock.calls[1][0]).toBe(b);
  });

  it('fails the run instead of leaving it stuck when the pipeline throws', async () => {
    const appId = createApp({ postingUrl: 'https://acme.de/jobs/1' });
    pipeline.mockImplementation(async () => {
      throw new Error('boom');
    });

    await service.start(appId);
    await service.whenIdle();

    expect(runs.activeRun(appId)).toBeUndefined();
    const failed = events.at(-1)!.run;
    expect(failed.status).toBe(AgentRunStatus.FAILED);
    expect(failed.error).toBeTruthy();
  });
});
