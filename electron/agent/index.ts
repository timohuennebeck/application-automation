/* Kepler's IPC surface. agent:start/retry/stop are the invoke channels; step
   progress rides agent:event, the app's first main→renderer push channel.
   Events fired while no window exists are dropped on purpose — SQLite holds
   the truth and the renderer catches up through db:load at boot. */
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import type { Repo } from '../db/repo.ts';
import { renderPdf } from '../pdf.ts';
import type {
  AgentEvent,
  AskRequest,
  AskResult,
  VariantsRequest,
  VariantsResult,
} from '../../src/shared/agent.ts';
import { createLlmRunner, sdkInvoke } from './llm.ts';
import { runPipeline } from './orchestrator.ts';
import { createRunStore } from './run-store.ts';
import { fetchListingText } from './scrape.ts';
import { createAgentService } from './service.ts';
import { createVariantsService } from './variants.ts';
import { createAskService } from './ask.ts';

/* What the rest of the main process needs from Kepler once the channels are
   wired: everything to drop when a card goes away. A run and the rewrites of an
   open letter are separate lifetimes, so both have to be told. */
export interface AgentTeardown {
  abandon(applicationId: string): void;
}

export function registerAgentIpc(
  getWin: () => BrowserWindow | null,
  db: DatabaseSync,
  repo: Repo,
  userDataPath: string,
): AgentTeardown {
  const runs = createRunStore(db);
  /* The app quit mid-run last time: settle those rows before the renderer
     loads its snapshot. */
  runs.recoverOrphans();

  const emit = (event: AgentEvent) => {
    /* The window may be mid-teardown (send on destroyed webContents throws).
       Dropping the event is fine — SQLite holds the truth and the renderer
       catches up from db:load. */
    try {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('agent:event', event);
    } catch (err) {
      console.error('[agent] emit dropped', err);
    }
  };

  const service = createAgentService({
    repo,
    runs,
    emit,
    pipeline: (applicationId, runId, signal) =>
      runPipeline(applicationId, runId, {
        signal,
        repo,
        runs,
        userDataPath,
        scrape: fetchListingText,
        llm: createLlmRunner(sdkInvoke()),
        renderPdf,
        emit,
      }),
  });

  /* Its own runner: the rewrite is a single call outside the queue, and giving
     it the pipeline's would tie its retry behaviour to a run it is not part of. */
  const variants = createVariantsService({
    repo,
    runs,
    userDataPath,
    llm: createLlmRunner(sdkInvoke()),
  });

  /* Same reasoning: a comment's answer is one call beside the queue. */
  const asks = createAskService({ repo, runs, llm: createLlmRunner(sdkInvoke()) });

  ipcMain.handle('agent:start', (_e, applicationId: string) => service.start(String(applicationId)));
  ipcMain.handle('agent:retry', (_e, applicationId: string) => service.retry(String(applicationId)));
  ipcMain.handle('agent:stop', (_e, applicationId: string) => service.stop(String(applicationId)));
  ipcMain.handle('agent:variantsStop', (_e, applicationId: string, callId?: string) =>
    variants.stop(String(applicationId), callId == null ? undefined : String(callId)),
  );
  ipcMain.handle('agent:variants', (_e, req: VariantsRequest): Promise<VariantsResult> => {
    /* A malformed payload is answered, not thrown: the editor shows whatever
       comes back in the header, and a rejected invoke would surface as the
       renderer's own exception with nothing said about the passage. */
    if (!req || typeof req !== 'object') {
      return Promise.resolve({ ok: false, error: 'Ungültige Anfrage.' });
    }
    return variants.suggest({
      applicationId: String(req.applicationId),
      /* Names the call so the square beside that passage can stop it. */
      callId: String(req.callId ?? ''),
      passage: String(req.passage ?? ''),
      letter: String(req.letter ?? ''),
      instruction: req.instruction == null ? null : String(req.instruction),
    });
  });

  ipcMain.handle('agent:ask', (_e, req: AskRequest): Promise<AskResult> => {
    if (!req || typeof req !== 'object') {
      return Promise.resolve({ ok: false, error: 'Ungültige Anfrage.' });
    }
    return asks.ask({ applicationId: String(req.applicationId), commentId: Number(req.commentId) });
  });

  return {
    abandon(applicationId: string): void {
      service.abandon(applicationId);
      asks.stop(applicationId);
      /* The card is gone, so nobody is waiting on its rewrites either — and
         each one holds a CLI subprocess and one of the three slots until its
         timeout runs out. */
      variants.stop(applicationId);
    },
  };
}
