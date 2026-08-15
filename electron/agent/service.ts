/* Validates and queues Kepler runs. One FIFO chain, concurrency 1: every run
   spawns a CLI subprocess plus hidden windows, and node:sqlite writes on the
   main thread — serial keeps both cheap and the UI legible. The pipeline
   itself is injected; this file owns only the lifecycle around it. */
import type { Repo } from '../db/repo.ts';
import type { RunStore } from './run-store.ts';
import { INTERRUPTED_HEADLINE } from '../../src/shared/agent.ts';
import type { AgentEvent, AgentStartResult } from '../../src/shared/agent.ts';
import { AgentRunStatus, AgentStepStatus } from '../../src/shared/enums.ts';
import { QUEUE_HEADLINE, STOP_ERROR, stepPlan } from './labels.ts';

interface AgentServiceDeps {
  repo: Repo;
  runs: RunStore;
  emit(event: AgentEvent): void;
  pipeline(applicationId: string, runId: number, signal: AbortSignal): Promise<void>;
}

export type AgentService = ReturnType<typeof createAgentService>;

export function createAgentService({ repo, runs, emit, pipeline }: AgentServiceDeps) {
  let chain: Promise<void> = Promise.resolve();
  /* One controller per queued attempt, keyed by run — stop() pulls it. A
     retry after a stop enqueues afresh under a new controller; the aborted
     link still reaches the front of the chain, sees its own signal, and
     bows out without touching the run. */
  const controllers = new Map<number, AbortController>();
  /* Which run each card currently has queued or running — what abandon()
     needs once the card's rows are gone. */
  const runByApp = new Map<string, number>();

  const enqueue = (applicationId: string, runId: number) => {
    const controller = new AbortController();
    controllers.set(runId, controller);
    runByApp.set(applicationId, runId);
    chain = chain.then(async () => {
      try {
        await pipeline(applicationId, runId, controller.signal);
      } catch (err) {
        /* The pipeline fails its own run; this backstop only catches a crash
           before it could — a run must never stay active forever. */
        try {
          if (runs.activeRun(applicationId)?.id === runId) {
            const failed = runs.failRun(
              runId,
              INTERRUPTED_HEADLINE,
              'Unerwarteter Fehler: ' + (err instanceof Error ? err.message : String(err)),
            );
            emit({ run: failed, steps: runs.stepsFor(runId) });
          }
        } catch (backstopErr) {
          /* Nothing may poison the chain — a rejected link would leave every
             later run QUEUED (and its card locked) forever. */
          console.error('[agent] backstop failed', backstopErr);
        }
      } finally {
        /* Only the link that still owns the run may clean up. A stopped link
           draining late must not unhook a retry that re-enqueued the same
           runId under a fresh controller — abandon() still needs the mapping
           to reach that retry's controller. */
        const owns = controllers.get(runId) === controller;
        if (owns) {
          controllers.delete(runId);
          if (runByApp.get(applicationId) === runId) runByApp.delete(applicationId);
        }
      }
    });
  };

  return {
    async start(applicationId: string): Promise<AgentStartResult> {
      const ctx = repo.getApplicationWithCompany(applicationId);
      if (!ctx) return { ok: false, error: 'Unbekannte Bewerbung.' };
      const { application, company } = ctx;
      if (!application.posting_url && !application.posting_text) {
        return { ok: false, error: 'Keine Stellenanzeige hinterlegt — Link oder Text fehlt.' };
      }
      if (runs.activeRun(applicationId)) {
        return { ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' };
      }

      /* Pasted text wins over the URL: it only exists because the user typed
         it in — usually after the page refused to be fetched. */
      const hasUrl = !!application.posting_url && !application.posting_text;
      const plan = stepPlan(hasUrl, {
        company: company.name,
        source: hasUrl ? application.channel || '' : '',
      });
      const created = runs.createRun(applicationId, QUEUE_HEADLINE, plan);
      emit({ run: created.run, steps: created.steps });
      enqueue(applicationId, created.run.id);
      return { ok: true };
    },

    /* Rewinds the failed step of the latest run and puts the run back in the
       queue — everything already done stays done and is not paid for again. */
    async retry(applicationId: string): Promise<AgentStartResult> {
      if (runs.activeRun(applicationId)) {
        return { ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' };
      }
      const run = runs.latestRun(applicationId);
      if (!run || run.status !== AgentRunStatus.FAILED) {
        return { ok: false, error: 'Kein fehlgeschlagener Schritt zum Wiederholen.' };
      }
      const failed = runs.stepsFor(run.id).find((s) => s.status === AgentStepStatus.ERROR);
      /* The failed label is already the step's infinitive — reuse it. */
      if (failed) runs.resetStep(failed.id, failed.label);
      const requeued = runs.requeueRun(run.id, QUEUE_HEADLINE);
      emit({ run: requeued, steps: runs.stepsFor(run.id) });
      enqueue(applicationId, run.id);
      return { ok: true };
    },

    /* Halts the active run. Running: the signal tears the in-flight call
       down and the pipeline fails its own step. Queued: nothing is in flight
       and the pipeline is not due for a while, so the rows are settled here —
       the next step takes the stop, and the retry can pick it back up. */
    async stop(applicationId: string): Promise<AgentStartResult> {
      const run = runs.activeRun(applicationId);
      if (!run) return { ok: false, error: 'Kepler arbeitet gerade nicht an dieser Bewerbung.' };
      const controller = controllers.get(run.id);
      controllers.delete(run.id);
      if (run.status === AgentRunStatus.QUEUED) {
        const next = runs.stepsFor(run.id).find((s) => s.status !== AgentStepStatus.DONE);
        /* A waiting label is already the infinitive the failed form uses. */
        if (next) runs.failStep(next.id, next.label, STOP_ERROR);
        const failed = runs.failRun(run.id, INTERRUPTED_HEADLINE, STOP_ERROR);
        emit({ run: failed, steps: runs.stepsFor(run.id) });
      }
      controller?.abort();
      return { ok: true };
    },

    /* The card was deleted: tear down whatever Kepler had in flight for it.
       Its run rows cascaded away with the card, so nothing is written — the
       signal just stops the SDK call or scrape from running on. */
    abandon(applicationId: string): void {
      const runId = runByApp.get(applicationId);
      if (runId === undefined) return;
      runByApp.delete(applicationId);
      const controller = controllers.get(runId);
      controllers.delete(runId);
      controller?.abort();
    },

    /* Settles once every queued pipeline has finished — for tests and shutdown. */
    whenIdle(): Promise<void> {
      return chain;
    },
  };
}
