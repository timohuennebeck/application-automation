/* Registers every DB_CHANNELS entry as an ipcMain handler on its repo
   function. The channel table itself lives in channels.ts, which preload
   shares — a new repo method only needs an entry there. */
import { ipcMain } from 'electron';
import { DB_CHANNELS } from './channels.ts';
import type { Repo } from './repo.ts';

/* Side effects that outlive the database row. Deleting an application cascades
   its child rows, but nothing in SQL clears the files on disk — and this is the
   one layer that knows about both. */
export interface DbIpcHooks {
  afterDeleteApplication?: (applicationId: string) => void;
  /* Receives what deleteComment returns: the attachment paths whose rows just
     cascaded away. */
  afterDeleteComment?: (removedPaths: string[]) => void;
}

export function registerDbIpc(repo: Repo, hooks: DbIpcHooks = {}): void {
  for (const [channel, method] of Object.entries(DB_CHANNELS)) {
    const fn = repo[method] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, (_e, ...args: unknown[]) => {
      const out = fn(...args);
      if (method === 'deleteApplication') hooks.afterDeleteApplication?.(args[0] as string);
      if (method === 'deleteComment') hooks.afterDeleteComment?.(out as string[]);
      return out;
    });
  }
}
