/* Kepler's IPC surface. agent:start/retry/stop are the invoke channels; step
   progress rides agent:event, the app's first main→renderer push channel.
   Events fired while no window exists are dropped on purpose — SQLite holds
   the truth and the renderer catches up through db:load at boot. */
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import type { Repo } from '../db/repo.ts';
import { renderPdf } from '../pdf.ts';
import type { AgentEvent } from '../../src/shared/agent.ts';
import { createLlmRunner, sdkInvoke } from './llm.ts';
import { runPipeline } from './orchestrator.ts';
import { createRunStore } from './run-store.ts';
import { fetchListingText } from './scrape.ts';
import { createAgentService, type AgentService } from './service.ts';

export function registerAgentIpc(
  getWin: () => BrowserWindow | null,
  db: DatabaseSync,
  repo: Repo,
  userDataPath: string,
): AgentService {
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

  ipcMain.handle('agent:start', (_e, applicationId: string) => service.start(String(applicationId)));
  ipcMain.handle('agent:retry', (_e, applicationId: string) => service.retry(String(applicationId)));
  ipcMain.handle('agent:stop', (_e, applicationId: string) => service.stop(String(applicationId)));

  return service;
}
